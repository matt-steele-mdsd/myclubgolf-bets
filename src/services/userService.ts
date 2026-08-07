import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { query } from '../db/query';

export interface BetUser extends RowDataPacket {
  BetUserID: number;
  Email: string;
  DisplayName: string;
  Active: number;
}

export async function findActiveUserByEmail(email: string): Promise<BetUser | null> {
  const rows = await query<BetUser[]>(
    'SELECT * FROM BetUser WHERE Email = ? AND Active = 1',
    [email.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

export async function getUserById(id: number): Promise<BetUser | null> {
  const rows = await query<BetUser[]>('SELECT * FROM BetUser WHERE BetUserID = ?', [id]);
  return rows[0] ?? null;
}

// Comma-separated allowlist of emails that can approve/reject signups. Reused as an env var
// (like RYDER_GROUP_ID/RYDER_YEAR) rather than a DB flag, since bootstrapping the first admin
// via a DB column would need the same manual-seed step this whole feature exists to avoid.
function adminEmailList(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmailList().includes(email.trim().toLowerCase());
}

// Every admin address to notify when something needs their attention (e.g. a new pending
// sign-up) -- same allowlist isAdminEmail checks against, just returned as a list instead of
// a membership test.
export function listAdminEmails(): string[] {
  return adminEmailList();
}

// Self-service signup: creates (or refreshes the name on) a BetUser row with Active = 0 --
// "on the roster but not yet allowed to sign in" -- findActiveUserByEmail's existing
// `WHERE Active = 1` filter already keeps a pending signup from getting a magic link, so no
// other auth-path change was needed to support this.
export async function registerPendingUser(firstName: string, lastName: string, email: string): Promise<void> {
  const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (!displayName || !normalizedEmail) throw new Error('First name, last name, and email are required');
  await query<ResultSetHeader>(
    `INSERT INTO BetUser (Email, DisplayName, Active) VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE DisplayName = VALUES(DisplayName)`,
    [normalizedEmail, displayName]
  );
}

export async function listPendingUsers(): Promise<BetUser[]> {
  return query<BetUser[]>('SELECT * FROM BetUser WHERE Active = 0 ORDER BY CreatedDt');
}

export async function listApprovedUsers(): Promise<BetUser[]> {
  return query<BetUser[]>('SELECT * FROM BetUser WHERE Active = 1 ORDER BY DisplayName');
}

export async function approveUser(id: number): Promise<BetUser | null> {
  const user = await getUserById(id);
  if (!user) return null;
  await query('UPDATE BetUser SET Active = 1 WHERE BetUserID = ?', [id]);
  return user;
}

// A rejected signup is just deleted rather than kept in a third "rejected" state -- nothing else
// references BetUserID at this point (no bets exist for someone who was never approved to place
// one), and if it was a mistake they can simply sign up again.
export async function rejectUser(id: number): Promise<void> {
  await query('DELETE FROM BetUser WHERE BetUserID = ? AND Active = 0', [id]);
}
