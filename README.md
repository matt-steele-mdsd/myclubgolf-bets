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
- **Authorization gate**: a magic link is only sent if the email matches an `Active` row in the
  `BetUser` table — this is what stops random people from signing up. `BetUser` currently has to
  be seeded manually (see "Known gap" below).
- Session is a signed, httpOnly JWT cookie (`rcb_session`), no server-side session store needed.

## Known gap — BetUser vs. the real Player table

This schema uses its own `BetUser` allowlist table rather than joining straight to RyderCup's
existing `Player` table, since that table's real columns weren't available to verify from the
session that scaffolded this. Two ways to close this:

1. **Quick start**: manually seed `BetUser` with real member emails/names (`INSERT INTO BetUser
   (Email, DisplayName) VALUES (...)`), independent of `Player`.
2. **Better long-term**: once `Player`'s real schema is confirmed (does it have `Email`? is it
   reliably populated?), swap `findActiveUserByEmail()` in `src/services/userService.ts` to query
   `Player` directly instead of `BetUser`, so the roster stays in sync automatically instead of
   needing manual upkeep.

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

Seed at least one real member so you can sign in and test:
```sql
INSERT INTO BetUser (Email, DisplayName) VALUES ('you@example.com', 'Your Name');
```

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

## Not built yet / deliberately out of scope for v1

- Editing/disputing a bet after acceptance (currently: settle as requester/accepter/push, or
  cancel while still open).
- Notifications (email or push) when a bet is accepted or settled.
- Admin/captain override to void a disputed bet.
- Rate limiting on `/auth/request-link` (worth adding before a real deploy, even though the
  same-response-either-way behavior already stops email enumeration).
