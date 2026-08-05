import cookieParser from 'cookie-parser';
import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import expressLayouts from 'express-ejs-layouts';
import path from 'path';
import { requestMagicLink, verifyMagicLink, verifySessionCookie } from './services/authService';
import { acceptBet, cancelBet, createBet, listBets, settleBet } from './services/betService';
import { BetUser, getUserById } from './services/userService';

declare module 'express-serve-static-core' {
  interface Request {
    user?: BetUser | null;
  }
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

app.use(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    const payload = verifySessionCookie(token);
    if (payload) {
      req.user = await getUserById(payload.sub);
    }
  }
  next();
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.redirect('/login');
  next();
}

app.get('/', (_req, res) => res.redirect('/bets'));

app.get('/login', (_req, res) => res.render('login', { title: 'Sign in' }));

app.post('/auth/request-link', async (req, res) => {
  const email = String(req.body.email ?? '');
  await requestMagicLink(email);
  res.render('check-email', { title: 'Check your email', email });
});

app.get('/auth/verify', async (req, res) => {
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
});

app.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

app.get('/bets', requireAuth, async (req, res) => {
  const bets = await listBets();
  res.render('bets', { title: 'Bets', bets, user: req.user });
});

app.post('/bets', requireAuth, async (req, res) => {
  const { description, amount } = req.body;
  await createBet(req.user!.BetUserID, String(description), Number(amount));
  res.redirect('/bets');
});

app.post('/bets/:id/accept', requireAuth, async (req, res) => {
  await acceptBet(Number(req.params.id), req.user!.BetUserID);
  res.redirect('/bets');
});

app.post('/bets/:id/settle', requireAuth, async (req, res) => {
  await settleBet(Number(req.params.id), req.body.winner);
  res.redirect('/bets');
});

app.post('/bets/:id/cancel', requireAuth, async (req, res) => {
  await cancelBet(Number(req.params.id), req.user!.BetUserID);
  res.redirect('/bets');
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`RyderCup Bets listening on :${PORT}`));
