# RyderCup Bets

A standalone web app (not distributed via the App Store or Play Store) for posting and accepting
informal bets between verified club members, sharing the RyderCup MySQL database. Kept separate
from the native RyderCup app so it never touches Apple/Google's real-money-wagering review
policies and can ship changes instantly with no review cycle.

**This is a ledger, not a payment processor.** It records who bet what with whom and who won —
settling up happens outside the app (cash, Venmo, etc.), same as the existing skins/payout
tracking in the Scorecard app. It never moves money itself.

## How auth works

- Passwordless: enter an email, get a one-time magic link, click it to sign in. No passwords to
  manage or reset.
- **Authorization gate**: a magic link is only sent if the email matches an `Active = 1` row in
  the `BetUser` table.
- **Self-service sign-up + approval, not manual seeding**: anyone can register at `/signup`
  (first name, last name, email) — this inserts a `BetUser` row with `Active = 0` ("on file, not
  yet allowed to sign in"). `findActiveUserByEmail()`'s existing `WHERE Active = 1` already keeps
  a pending signup from getting a magic link, so no other auth-path change was needed. Anyone
  listed in `ADMIN_EMAILS` (comma-separated env var — no DB flag, so the first admin doesn't need
  a manual-seed bootstrap step either) can Approve (`Active = 1`) or Reject (row deleted) pending
  signups at `/admin/approvals`. Approval sends the person a "you're in, sign in here" email.
- Session is a signed, httpOnly JWT cookie (`rcb_session`), no server-side session store needed.

## Known gap — BetUser vs. the real Player table

**Checked 2026-08-06**: `RyderPlayer.Email` exists but is 0% populated (0 of 78 rows locally, 0
of 144 in production) — so joining directly to `RyderPlayer` isn't viable yet. Sticking with the
`BetUser` allowlist table, manually seeded:

```sql
INSERT INTO BetUser (Email, DisplayName) VALUES ('you@example.com', 'Your Name');
```

If `RyderPlayer.Email` ever gets populated (e.g. captains start collecting it during roster
setup), `findActiveUserByEmail()` in `src/services/userService.ts` can be swapped to query
`RyderPlayer` directly instead, so the roster stays in sync automatically.

## Setup

```bash
npm install
cp .env.example .env   # fill in DB_*, JWT_SECRET, SMTP_* — see below
```

Generate a session signing secret:
```bash
openssl rand -hex 32   # paste into JWT_SECRET
```

Run the migration against the RyderCup database:
```bash
mysql -h <host> -u <user> -p <database> < migrations/001_init.sql
```

Seed yourself as the first approved admin (everyone else can self-sign-up at `/signup` and get
approved through `/admin/approvals` once you're in):
```sql
INSERT INTO BetUser (Email, DisplayName, Active) VALUES ('you@example.com', 'Your Name', 1);
```
Then set `ADMIN_EMAILS` in `.env` to include that same email (plus any other admins) so you can
reach `/admin/approvals`.

### SMTP

Needs real SMTP credentials to actually send magic-link emails — any provider works (existing
club email host, or a free tier of something like Mailgun/SES). `SMTP_FROM` should be a real
sending address on a domain you control (e.g. `bets@myclubgolf.com`) so it doesn't land in spam.

## Run locally

```bash
npm run dev      # tsx watch, http://localhost:3100
```

## Deploy (cPanel/Passenger, same pattern as phoneai-api / ryder-api)

1. `npm run build` (compiles `src/` to `dist/`).
2. Set up a new Passenger Node app in cPanel on its own subdomain (e.g. `bets.myclubgolf.com`),
   `--app-root` pointing at wherever this repo lives on the server, `--startup-file
   dist/server.js` — mirrors the `cloudlinux-selector create` steps already documented in the
   Scorecard repo's `ARCHITECTURE.md` for `ryder-api`/`phoneai-api`.
3. Set the real env vars (`DB_*`, `JWT_SECRET`, `SMTP_*`, `APP_BASE_URL`) in the cPanel Node app
   config — **do not** hardcode credentials into `src/db/config.ts` the way `phoneai-api` had to
   (see that repo's `AGENTS.md` for why that happened and why it's best avoided from the start
   here).
4. Upload `dist/*`, `views/`, `public/`, `package.json`, then `npm install --production` on the
   server, then touch `tmp/restart.txt` to get Passenger to pick it up.

## Bets

`/bets` is browsed one session at a time via a tab bar — mirrors RyderCup's own Session
Leaderboard picker — with **Overall Winner** as one more tab alongside the real sessions
(`RyderSession` rows for the configured event/year). Picking a tab scopes both the "new bet"
form and the bet list below it; `BetRequest.SessionID` is denormalized (populated at creation
from the picked match) so that filtering is a plain `WHERE`, not a join, on every page load.

Every bet is either:
- **`match`** — tied to a real `(RyderYear, GroupID, MatchID)` row in the shared RyderCup
  database. Only matches with pairings set (`RyderMatch`) but no posted result yet
  (`RyderMatchResults`) are offered. Once a result is posted, settlement is **not** a manual
  pick — `settleBet()` reads the real `Winner` off `RyderMatchResults` and computes
  requester/accepter/push from it directly, so it can't be gamed by whichever party clicks
  Settle first. See `src/services/matchService.ts` / `betService.ts`.
- **`overall`** — who wins the whole event (Team USA vs Europe), booked from the Overall Winner
  tab. No per-match dependency, so it's biddable before any pairings exist. Settlement is still
  a manual pick (no single DB row represents "the event is over and X won"), same as the
  original scaffold's settle flow.

`RYDER_GROUP_ID` / `RYDER_YEAR` in `.env` control which event bets are booked against — bump
`RYDER_YEAR` each year rather than changing code.

Email notifications go out on accept (to the requester) and on settle (to both parties) —
`sendBetAcceptedEmail` / `sendBetSettledEmail` in `src/services/emailService.ts`. A failed send
is logged, not thrown — a broken SMTP config shouldn't block the underlying bet action.

## Not built yet / deliberately out of scope for v1

- Editing/disputing a bet after acceptance (currently: settle as requester/accepter/push for
  overall bets, auto-verified for match bets, or cancel while still open).
- Admin/captain override to void a disputed bet.
- Rate limiting on `/auth/request-link` (worth adding before a real deploy, even though the
  same-response-either-way behavior already stops email enumeration).
