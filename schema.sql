-- Drift Sea: every sentence released into the sea, and the reports against them.
CREATE TABLE IF NOT EXISTS fish (
  id      TEXT PRIMARY KEY,
  text    TEXT    NOT NULL,
  at      INTEGER NOT NULL,            -- ms since epoch
  owner   TEXT    NOT NULL,            -- hash of the visitor's browser token, lets them spot their own creatures
  ip      TEXT    NOT NULL,            -- salted hash of the IP, only for rate limits and one report per person
  reports INTEGER NOT NULL DEFAULT 0,
  hidden  INTEGER NOT NULL DEFAULT 0   -- set once enough people report it
);
CREATE INDEX IF NOT EXISTS fish_visible ON fish (hidden, at);
CREATE INDEX IF NOT EXISTS fish_ip ON fish (ip, at);

CREATE TABLE IF NOT EXISTS reports (
  fish_id TEXT    NOT NULL,
  ip      TEXT    NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (fish_id, ip)
);
