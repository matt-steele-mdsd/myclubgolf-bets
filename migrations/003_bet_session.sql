-- RyderCup Bets — session-scoped browsing
--
-- The bets page now browses by session (matching how RyderCup's own Session Leaderboard works)
-- with "Overall Winner" as one more tab alongside the real sessions. Denormalizing SessionID
-- onto BetRequest (rather than joining through RyderMatch every time) keeps that filtering a
-- plain WHERE clause -- same reasoning as RyderYear/GroupID already being denormalized here.

ALTER TABLE BetRequest
  ADD COLUMN SessionID INT NULL AFTER MatchID;
