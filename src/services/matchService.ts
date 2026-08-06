import { RowDataPacket } from 'mysql2';
import { query } from '../db/query';

// Which RyderCup event/year this app currently books bets for. Set as env vars (not hardcoded)
// so next year's event can be pointed at without a code change -- see RyderEvents/RyderSession
// in the shared `rydercup` database for the source of truth.
export const GROUP_ID = Number(process.env.RYDER_GROUP_ID ?? 1);
export const RYDER_YEAR = Number(process.env.RYDER_YEAR ?? new Date().getFullYear());

export interface SessionInfo extends RowDataPacket {
  SessionID: number;
  Name: string;
}

// The session tab bar on /bets mirrors RyderCup's own Session Leaderboard picker.
export async function listSessions(): Promise<SessionInfo[]> {
  return query<SessionInfo[]>(
    'SELECT SessionID, Name FROM RyderSession WHERE GroupID = ? AND RyderYear = ? ORDER BY SessionID',
    [GROUP_ID, RYDER_YEAR]
  );
}

export interface BettableMatch extends RowDataPacket {
  MatchID: number;
  SessionID: number;
  SessionName: string;
  UsaPlayers: string | null;
  EuroPlayers: string | null;
}

// Matches with per-player pairings set (RyderMatch) but no posted result yet (RyderMatchResults)
// -- once a result exists there's nothing left to bet on, so it's excluded here rather than
// filtered client-side. Scoped to one session at a time to match the tab-bar UI.
export async function listBettableMatches(sessionId: number): Promise<BettableMatch[]> {
  return query<BettableMatch[]>(
    `SELECT m.MatchID, m.SessionID, s.Name AS SessionName,
        GROUP_CONCAT(CASE WHEN m.Team = 'U' THEN CONCAT(p.FirstName, ' ', p.LastName) END SEPARATOR ' & ') AS UsaPlayers,
        GROUP_CONCAT(CASE WHEN m.Team = 'E' THEN CONCAT(p.FirstName, ' ', p.LastName) END SEPARATOR ' & ') AS EuroPlayers
     FROM RyderMatch m
     JOIN RyderSession s ON s.GroupID = m.GroupID AND s.RyderYear = m.RyderYear AND s.SessionID = m.SessionID
     JOIN RyderPlayer p ON p.PlayerID = m.PlayerID AND p.GroupID = m.GroupID
     LEFT JOIN RyderMatchResults r ON r.GroupID = m.GroupID AND r.RyderYear = m.RyderYear AND r.MatchID = m.MatchID
     WHERE m.GroupID = ? AND m.RyderYear = ? AND m.SessionID = ? AND r.MatchID IS NULL
     GROUP BY m.MatchID, m.SessionID, s.Name
     ORDER BY m.MatchID`,
    [GROUP_ID, RYDER_YEAR, sessionId]
  );
}

export interface MatchInfo extends RowDataPacket {
  MatchID: number;
  SessionID: number;
  SessionName: string;
  UsaPlayers: string | null;
  EuroPlayers: string | null;
}

// Looked up per-bet when rendering the bets list, so a settled/older match still displays its
// session/player names even though it's no longer in listBettableMatches().
export async function getMatchInfo(matchId: number): Promise<MatchInfo | null> {
  const rows = await query<MatchInfo[]>(
    `SELECT m.MatchID, m.SessionID, s.Name AS SessionName,
        GROUP_CONCAT(CASE WHEN m.Team = 'U' THEN CONCAT(p.FirstName, ' ', p.LastName) END SEPARATOR ' & ') AS UsaPlayers,
        GROUP_CONCAT(CASE WHEN m.Team = 'E' THEN CONCAT(p.FirstName, ' ', p.LastName) END SEPARATOR ' & ') AS EuroPlayers
     FROM RyderMatch m
     JOIN RyderSession s ON s.GroupID = m.GroupID AND s.RyderYear = m.RyderYear AND s.SessionID = m.SessionID
     JOIN RyderPlayer p ON p.PlayerID = m.PlayerID AND p.GroupID = m.GroupID
     WHERE m.GroupID = ? AND m.RyderYear = ? AND m.MatchID = ?
     GROUP BY m.MatchID, m.SessionID, s.Name`,
    [GROUP_ID, RYDER_YEAR, matchId]
  );
  return rows[0] ?? null;
}

export interface MatchResult extends RowDataPacket {
  Winner: 'U' | 'E' | 'B';
  Result: string | null;
}

export async function getMatchResult(matchId: number): Promise<MatchResult | null> {
  const rows = await query<MatchResult[]>(
    'SELECT Winner, Result FROM RyderMatchResults WHERE GroupID = ? AND RyderYear = ? AND MatchID = ?',
    [GROUP_ID, RYDER_YEAR, matchId]
  );
  return rows[0] ?? null;
}
