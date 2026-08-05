-- RyderCup Bets — initial schema
-- Run against the same MySQL instance/database the RyderCup app uses.
--
-- This starts with its own BetUser allowlist table rather than joining
-- directly to RyderCup's Player table, since that schema hasn't been
-- confirmed from this session. Once Player's real columns (Email in
-- particular) are verified, findActiveUserByEmail() in src/services/
-- userService.ts can be swapped to join against Player instead of
-- requiring BetUser to be seeded manually.

CREATE TABLE IF NOT EXISTS BetUser (
  BetUserID INT AUTO_INCREMENT PRIMARY KEY,
  Email VARCHAR(255) NOT NULL UNIQUE,
  DisplayName VARCHAR(255) NOT NULL,
  Active TINYINT(1) NOT NULL DEFAULT 1,
  CreatedDt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  LastUpdateDt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS BetAuthToken (
  TokenID INT AUTO_INCREMENT PRIMARY KEY,
  Email VARCHAR(255) NOT NULL,
  Token CHAR(64) NOT NULL UNIQUE,
  ExpiresDt DATETIME NOT NULL,
  UsedDt DATETIME NULL,
  CreatedDt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bet_auth_token_email (Email)
);

CREATE TABLE IF NOT EXISTS BetRequest (
  BetID INT AUTO_INCREMENT PRIMARY KEY,
  RequesterBetUserID INT NOT NULL,
  Description VARCHAR(500) NOT NULL,
  Amount DECIMAL(10,2) NOT NULL,
  Status ENUM('open','accepted','settled','cancelled') NOT NULL DEFAULT 'open',
  CreatedDt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  LastUpdateDt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (RequesterBetUserID) REFERENCES BetUser(BetUserID)
);

CREATE TABLE IF NOT EXISTS BetAcceptance (
  AcceptanceID INT AUTO_INCREMENT PRIMARY KEY,
  BetID INT NOT NULL,
  AccepterBetUserID INT NOT NULL,
  AcceptedDt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  SettledDt DATETIME NULL,
  Winner ENUM('requester','accepter','push') NULL,
  FOREIGN KEY (BetID) REFERENCES BetRequest(BetID),
  FOREIGN KEY (AccepterBetUserID) REFERENCES BetUser(BetUserID),
  UNIQUE KEY uniq_bet_accepter (BetID, AccepterBetUserID)
);
