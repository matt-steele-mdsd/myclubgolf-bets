-- RyderCup Bets — structured bets
--
-- Replaces the freeform "what's the bet?" text field with bets tied to real RyderCup match/event
-- data. myclubgolf-bets shares the same database as the RyderCup app, so a bet can reference an
-- actual (RyderYear, GroupID, MatchID) row instead of trusting a human's typed description --
-- and once RyderMatchResults has a row for that match, settlement can be auto-verified against
-- the real outcome instead of relying on whichever party clicks "Settle" first.
--
-- BetType='match' bets require MatchID; BetType='overall' bets (who wins the whole event) don't
-- reference a specific match. PickedTeam is which team ('U' or 'E') the requester is betting on
-- -- the accepter implicitly takes the other side.

ALTER TABLE BetRequest
  ADD COLUMN BetType ENUM('match','overall') NOT NULL DEFAULT 'match' AFTER RequesterBetUserID,
  ADD COLUMN RyderYear INT NOT NULL AFTER BetType,
  ADD COLUMN GroupID INT NOT NULL AFTER RyderYear,
  ADD COLUMN MatchID INT NULL AFTER GroupID,
  ADD COLUMN PickedTeam CHAR(1) NOT NULL AFTER MatchID,
  MODIFY COLUMN Description VARCHAR(500) NULL,
  ADD CONSTRAINT chk_bet_match_id CHECK (
    (BetType = 'match' AND MatchID IS NOT NULL) OR
    (BetType = 'overall' AND MatchID IS NULL)
  ),
  ADD CONSTRAINT chk_bet_picked_team CHECK (PickedTeam IN ('U','E'));
