import { RowDataPacket } from 'mysql2';
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
