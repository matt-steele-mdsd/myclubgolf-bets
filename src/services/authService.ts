import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2';
import { query } from '../db/query';
import { sendMagicLinkEmail } from './emailService';
import { findActiveUserByEmail } from './userService';

const TTL_MINUTES = Number(process.env.MAGIC_LINK_TTL_MINUTES ?? 15);
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

interface AuthTokenRow extends RowDataPacket {
  TokenID: number;
  Email: string;
}

export async function requestMagicLink(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const user = await findActiveUserByEmail(email);
  if (!user) {
    // Same response whether or not the email is on the roster, so this
    // endpoint can't be used to enumerate club members.
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TTL_MINUTES * 60_000);
  await query('INSERT INTO BetAuthToken (Email, Token, ExpiresDt) VALUES (?, ?, ?)', [
    email,
    token,
    expires,
  ]);

  const link = `${process.env.APP_BASE_URL}/auth/verify?token=${token}`;
  await sendMagicLinkEmail(email, link);
}

export async function verifyMagicLink(token: string): Promise<string | null> {
  const rows = await query<AuthTokenRow[]>(
    'SELECT * FROM BetAuthToken WHERE Token = ? AND UsedDt IS NULL AND ExpiresDt > NOW()',
    [token]
  );
  const record = rows[0];
  if (!record) return null;

  await query('UPDATE BetAuthToken SET UsedDt = NOW() WHERE TokenID = ?', [record.TokenID]);

  const user = await findActiveUserByEmail(record.Email);
  if (!user) return null;

  return signSessionCookie(user.BetUserID, user.Email);
}

export function signSessionCookie(betUserId: number, email: string): string {
  return jwt.sign({ sub: betUserId, email }, requireSecret(), {
    expiresIn: `${SESSION_TTL_DAYS}d`,
  });
}

export function verifySessionCookie(token: string): { sub: number; email: string } | null {
  try {
    return jwt.verify(token, requireSecret()) as unknown as { sub: number; email: string };
  } catch {
    return null;
  }
}

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}
