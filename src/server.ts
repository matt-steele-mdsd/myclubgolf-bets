import cookieParser from 'cookie-parser';
import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import expressLayouts from 'express-ejs-layouts';
import path from 'path';
import { requestMagicLink, verifyMagicLink, verifySessionCookie } from './services/authService';
import { acceptBet, BetScope, cancelBet, createBet, listBets, settleBet } from './services/betService';
import { sendApprovedEmail, sendNewSignupEmail } from './services/emailService';
import { listBettableMatches, listSessions } from './services/matchService';
import {
  approveUser,
  BetUser,
  getUserById,
  isAdminEmail,
  listAdminEmails,
  listApprovedUsers,
  listPendingUsers,
  registerPendingUser,
  rejectUser,
} from './services/userService';

// Resolves the ?session= query param (either "overall" or a numeric SessionID) into a redirect
// target and a BetScope -- shared by every route that needs to stay on the same tab after a
// POST. Defaults to "overall" when no valid param is given: picking the overall-winner side is
// what most people want to do, and it's biddable before any match pairings even exist, so it's
// the one tab guaranteed to always have something to bet on.
async function resolveSessionParam(raw: unknown): Promise<{ scope: BetScope; sessionParam: string }> {
  if (raw === 'overall' || raw === undefined) return { scope: 'overall', sessionParam: 'overall' };
  const sessions = await listSessions();
  const asNumber = Number(raw);
  if (sessions.some((s) => s.SessionID === asNumber)) {
    return { scope: { sessionId: asNumber }, sessionParam: String(asNumber) };
  }
  return { scope: 'overall', sessionParam: 'overall' };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: BetUser | null;
  }
}

// Express 4 doesn't forward a rejected promise from an async route handler to the error
// middleware on its own -- left unwrapped, any DB hiccup or SMTP failure becomes an unhandled
// rejection that crashes the whole process for every user, not just the one failed request.
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const app = express();
const PORT = process.env.PORT ?? 3100;
const COOKIE_NAME = 'rcb_session';
const VIEWS_DIR = path.join(__dirname, '..', 'views');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.set('view engine', 'ejs');
app.set('views', VIEWS_DIR);
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

app.use(
  asyncHandler(async (req, _res, next) => {
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      const payload = verifySessionCookie(token);
      if (payload) {
        req.user = await getUserById(payload.sub);
      }
    }
    next();
  })
);

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !isAdminEmail(req.user.Email)) return res.redirect('/bets');
  next();
}

app.get('/', (_req, res) => res.redirect('/bets'));

app.get('/login', (_req, res) => res.render('login', { title: 'Sign in' }));

app.get('/signup', (_req, res) => res.render('signup', { title: 'Sign up to bet' }));

app.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const firstName = String(req.body.firstName ?? '');
    const lastName = String(req.body.lastName ?? '');
    const email = String(req.body.email ?? '');
    await registerPendingUser(firstName, lastName, email);
    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
    try {
      await Promise.all(listAdminEmails().map((adminEmail) => sendNewSignupEmail(adminEmail, displayName, email.trim())));
    } catch (err) {
      console.error(`Failed to send new-signup notification for ${email}:`, err);
    }
    res.render('signup-thanks', { title: 'Thanks!' });
  })
);

app.get(
  '/admin/approvals',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const pending = await listPendingUsers();
    res.render('admin-approvals', { title: 'Pending Approvals', pending });
  })
);

app.get(
  '/admin/emails',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const approved = await listApprovedUsers();
    res.render('admin-emails', { title: 'Email List', approved });
  })
);

app.post(
  '/admin/approvals/:id/approve',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await approveUser(Number(req.params.id));
    if (user) {
      try {
        await sendApprovedEmail(user.Email);
      } catch (err) {
        console.error(`Failed to send approval email for BetUserID ${user.BetUserID}:`, err);
      }
    }
    res.redirect('/admin/approvals');
  })
);

app.post(
  '/admin/approvals/:id/reject',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await rejectUser(Number(req.params.id));
    res.redirect('/admin/approvals');
  })
);

app.post(
  '/auth/request-link',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email ?? '');
    try {
      await requestMagicLink(email);
    } catch (err) {
      // Same response either way, whether the email matched a roster or the mailer itself
      // failed -- this preserves the no-email-enumeration property. The failure is still
      // logged below so a broken SMTP config gets noticed and fixed, just not leaked to callers.
      console.error('Failed to send magic-link email:', err);
    }
    res.render('check-email', { title: 'Check your email', email });
  })
);

app.get(
  '/auth/verify',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? '');
    const sessionToken = await verifyMagicLink(token);
    if (!sessionToken) {
      return res.status(400).render('error', {
        title: 'Link expired',
        message: 'That sign-in link is invalid or has expired. Request a new one.',
      });
    }
    res.cookie(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: Number(process.env.SESSION_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000,
    });
    res.redirect('/bets');
  })
);

app.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

app.get(
  '/bets',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await listSessions();
    const { scope, sessionParam } = await resolveSessionParam(req.query.session);
    const isAdmin = isAdminEmail(req.user!.Email);
    const [bets, matches, pendingCount] = await Promise.all([
      listBets(scope),
      scope === 'overall' ? Promise.resolve([]) : listBettableMatches(scope.sessionId),
      isAdmin ? listPendingUsers().then((p) => p.length) : Promise.resolve(0),
    ]);
    res.render('bets', {
      title: 'Bets',
      bets,
      matches,
      sessions,
      activeSession: sessionParam,
      user: req.user,
      isAdmin,
      pendingCount,
    });
  })
);

app.post(
  '/bets',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionParam } = await resolveSessionParam(req.body.session);
    const pickedTeam = req.body.pickedTeam === 'E' ? 'E' : 'U';
    const amount = Number(req.body.amount);
    if (sessionParam === 'overall') {
      await createBet(req.user!.BetUserID, 'overall', pickedTeam, amount, null);
    } else {
      const matchId = req.body.matchId ? Number(req.body.matchId) : null;
      await createBet(req.user!.BetUserID, 'match', pickedTeam, amount, matchId);
    }
    res.redirect(`/bets?session=${sessionParam}`);
  })
);

app.post(
  '/bets/:id/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionParam } = await resolveSessionParam(req.query.session);
    await acceptBet(Number(req.params.id), req.user!.BetUserID);
    res.redirect(`/bets?session=${sessionParam}`);
  })
);

app.post(
  '/bets/:id/settle',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionParam } = await resolveSessionParam(req.query.session);
    await settleBet(Number(req.params.id), req.body.winner);
    res.redirect(`/bets?session=${sessionParam}`);
  })
);

app.post(
  '/bets/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionParam } = await resolveSessionParam(req.query.session);
    await cancelBet(Number(req.params.id), req.user!.BetUserID);
    res.redirect(`/bets?session=${sessionParam}`);
  })
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Final safety net for anything asyncHandler forwards, or any synchronous throw above --
// without this, Express's default HTML stack-trace page would render for real users.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled request error:', err);
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
  });
});

app.listen(PORT, () => console.log(`RyderCup Bets listening on :${PORT}`));
