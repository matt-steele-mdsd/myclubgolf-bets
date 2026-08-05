import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { query } from '../db/query';

export interface BetRequestRow extends RowDataPacket {
  BetID: number;
  RequesterBetUserID: number;
  RequesterName: string;
  Description: string;
  Amount: string;
  Status: 'open' | 'accepted' | 'settled' | 'cancelled';
  CreatedDt: string;
  AccepterName: string | null;
  Winner: 'requester' | 'accepter' | 'push' | null;
}

export async function listBets(): Promise<BetRequestRow[]> {
  return query<BetRequestRow[]>(`
    SELECT br.BetID, br.RequesterBetUserID, ru.DisplayName AS RequesterName,
           br.Description, br.Amount, br.Status, br.CreatedDt,
           au.DisplayName AS AccepterName, ba.Winner
    FROM BetRequest br
    JOIN BetUser ru ON ru.BetUserID = br.RequesterBetUserID
    LEFT JOIN BetAcceptance ba ON ba.BetID = br.BetID
    LEFT JOIN BetUser au ON au.BetUserID = ba.AccepterBetUserID
    ORDER BY br.CreatedDt DESC
  `);
}

export async function createBet(
  requesterId: number,
  description: string,
  amount: number
): Promise<void> {
  await query<ResultSetHeader>(
    'INSERT INTO BetRequest (RequesterBetUserID, Description, Amount) VALUES (?, ?, ?)',
    [requesterId, description, amount]
  );
}

export async function acceptBet(betId: number, accepterId: number): Promise<void> {
  const rows = await query<RowDataPacket[]>(
    'SELECT RequesterBetUserID, Status FROM BetRequest WHERE BetID = ?',
    [betId]
  );
  const bet = rows[0];
  if (!bet || bet.Status !== 'open') throw new Error('Bet is not open');
  if (bet.RequesterBetUserID === accepterId) throw new Error('Cannot accept your own bet');

  await query('INSERT INTO BetAcceptance (BetID, AccepterBetUserID) VALUES (?, ?)', [
    betId,
    accepterId,
  ]);
  await query("UPDATE BetRequest SET Status = 'accepted' WHERE BetID = ?", [betId]);
}

export async function settleBet(
  betId: number,
  winner: 'requester' | 'accepter' | 'push'
): Promise<void> {
  await query("UPDATE BetRequest SET Status = 'settled' WHERE BetID = ?", [betId]);
  await query('UPDATE BetAcceptance SET SettledDt = NOW(), Winner = ? WHERE BetID = ?', [
    winner,
    betId,
  ]);
}

export async function cancelBet(betId: number, requesterId: number): Promise<void> {
  await query(
    "UPDATE BetRequest SET Status = 'cancelled' WHERE BetID = ? AND RequesterBetUserID = ? AND Status = 'open'",
    [betId, requesterId]
  );
}
