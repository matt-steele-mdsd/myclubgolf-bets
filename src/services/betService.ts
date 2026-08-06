import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { query } from '../db/query';
import { sendBetAcceptedEmail, sendBetSettledEmail } from './emailService';
import { GROUP_ID, RYDER_YEAR, getMatchInfo, getMatchResult } from './matchService';

export interface BetRequestRow extends RowDataPacket {
  BetID: number;
  RequesterBetUserID: number;
  RequesterName: string;
  BetType: 'match' | 'overall';
  MatchID: number | null;
  SessionID: number | null;
  PickedTeam: 'U' | 'E';
  Description: string;
  Amount: string;
  Status: 'open' | 'accepted' | 'settled' | 'cancelled';
  CreatedDt: string;
  AccepterBetUserID: number | null;
  AccepterName: string | null;
  Winner: 'requester' | 'accepter' | 'push' | null;
  MatchWinner: 'U' | 'E' | 'B' | null;
  MatchResultText: string | null;
}

// Bets are browsed one tab at a time -- a real session's matches, or the "Overall Winner"
// pseudo-tab -- mirroring RyderCup's own Session Leaderboard picker rather than one long flat list.
export type BetScope = { sessionId: number } | 'overall';

export async function listBets(scope: BetScope): Promise<BetRequestRow[]> {
  const where = scope === 'overall' ? "br.BetType = 'overall'" : 'br.SessionID = ?';
  const params = scope === 'overall' ? [] : [scope.sessionId];
  return query<BetRequestRow[]>(
    `SELECT br.BetID, br.RequesterBetUserID, ru.DisplayName AS RequesterName,
            br.BetType, br.MatchID, br.SessionID, br.PickedTeam,
            br.Description, br.Amount, br.Status, br.CreatedDt,
            ba.AccepterBetUserID, au.DisplayName AS AccepterName, ba.Winner,
            mr.Winner AS MatchWinner, mr.Result AS MatchResultText
     FROM BetRequest br
     JOIN BetUser ru ON ru.BetUserID = br.RequesterBetUserID
     LEFT JOIN BetAcceptance ba ON ba.BetID = br.BetID
     LEFT JOIN BetUser au ON au.BetUserID = ba.AccepterBetUserID
     LEFT JOIN RyderMatchResults mr
       ON mr.GroupID = br.GroupID AND mr.RyderYear = br.RyderYear AND mr.MatchID = br.MatchID
     WHERE ${where}
     ORDER BY br.CreatedDt DESC`,
    params
  );
}

async function buildDescription(
  betType: 'match' | 'overall',
  pickedTeam: 'U' | 'E',
  matchId: number | null
): Promise<string> {
  const teamName = pickedTeam === 'U' ? 'Team USA' : 'Team Europe';
  if (betType === 'overall') return `${teamName} to win the Ryder Cup overall`;
  const info = matchId ? await getMatchInfo(matchId) : null;
  const label = info ? `${info.SessionName} — Match ${matchId} (${info.UsaPlayers} vs ${info.EuroPlayers})` : `Match ${matchId}`;
  return `${teamName} to win: ${label}`;
}

export async function createBet(
  requesterId: number,
  betType: 'match' | 'overall',
  pickedTeam: 'U' | 'E',
  amount: number,
  matchId: number | null
): Promise<void> {
  if (betType === 'match' && !matchId) throw new Error('matchId is required for match bets');
  const info = betType === 'match' && matchId ? await getMatchInfo(matchId) : null;
  if (betType === 'match' && !info) throw new Error('Unknown match');
  const description = await buildDescription(betType, pickedTeam, betType === 'match' ? matchId : null);
  await query<ResultSetHeader>(
    `INSERT INTO BetRequest (RequesterBetUserID, BetType, RyderYear, GroupID, MatchID, SessionID, PickedTeam, Description, Amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [requesterId, betType, RYDER_YEAR, GROUP_ID, betType === 'match' ? matchId : null, info?.SessionID ?? null, pickedTeam, description, amount]
  );
}

export async function acceptBet(betId: number, accepterId: number): Promise<void> {
  const rows = await query<RowDataPacket[]>(
    `SELECT br.RequesterBetUserID, br.Status, br.Description, br.Amount, ru.Email AS RequesterEmail
     FROM BetRequest br JOIN BetUser ru ON ru.BetUserID = br.RequesterBetUserID
     WHERE br.BetID = ?`,
    [betId]
  );
  const bet = rows[0];
  if (!bet || bet.Status !== 'open') throw new Error('Bet is not open');
  if (bet.RequesterBetUserID === accepterId) throw new Error('Cannot accept your own bet');

  await query('INSERT INTO BetAcceptance (BetID, AccepterBetUserID) VALUES (?, ?)', [betId, accepterId]);
  await query("UPDATE BetRequest SET Status = 'accepted' WHERE BetID = ?", [betId]);

  try {
    await sendBetAcceptedEmail(bet.RequesterEmail, bet.Description, bet.Amount);
  } catch (err) {
    console.error(`Failed to send bet-accepted email for bet ${betId}:`, err);
  }
}

export async function settleBet(
  betId: number,
  winnerInput?: 'requester' | 'accepter' | 'push'
): Promise<void> {
  const rows = await query<RowDataPacket[]>(
    `SELECT br.*, ru.Email AS RequesterEmail, ba.AccepterBetUserID, au.Email AS AccepterEmail
     FROM BetRequest br
     JOIN BetUser ru ON ru.BetUserID = br.RequesterBetUserID
     JOIN BetAcceptance ba ON ba.BetID = br.BetID
     JOIN BetUser au ON au.BetUserID = ba.AccepterBetUserID
     WHERE br.BetID = ?`,
    [betId]
  );
  const bet = rows[0];
  if (!bet) throw new Error('Bet not found');
  if (bet.Status !== 'accepted') throw new Error('Bet is not accepted');

  let winner: 'requester' | 'accepter' | 'push';
  if (bet.BetType === 'match') {
    // Never trust a manual pick for a match bet -- settle strictly from the real posted result,
    // so settlement can't be gamed by whoever clicks the button first.
    const result = await getMatchResult(bet.MatchID);
    if (!result) throw new Error('Match result has not been posted yet');
    winner = result.Winner === 'B' ? 'push' : result.Winner === bet.PickedTeam ? 'requester' : 'accepter';
  } else {
    if (!winnerInput) throw new Error('winner is required to settle an overall bet');
    winner = winnerInput;
  }

  await query("UPDATE BetRequest SET Status = 'settled' WHERE BetID = ?", [betId]);
  await query('UPDATE BetAcceptance SET SettledDt = NOW(), Winner = ? WHERE BetID = ?', [winner, betId]);

  try {
    await sendBetSettledEmail(bet.RequesterEmail, bet.Description, bet.Amount, winner, 'requester');
    await sendBetSettledEmail(bet.AccepterEmail, bet.Description, bet.Amount, winner, 'accepter');
  } catch (err) {
    console.error(`Failed to send bet-settled email(s) for bet ${betId}:`, err);
  }
}

export async function cancelBet(betId: number, requesterId: number): Promise<void> {
  await query(
    "UPDATE BetRequest SET Status = 'cancelled' WHERE BetID = ? AND RequesterBetUserID = ? AND Status = 'open'",
    [betId, requesterId]
  );
}
