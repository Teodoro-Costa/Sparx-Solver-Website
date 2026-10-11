-- One row per user per day: a random install ID (not linked to the person)
-- and how many times each feature was used. No IPs, questions or answers.
-- WITHOUT ROWID + composite key = exactly one row written per daily ping.
CREATE TABLE IF NOT EXISTS pings (
  day TEXT NOT NULL,
  id TEXT NOT NULL,
  v TEXT NOT NULL,
  model TEXT NOT NULL,
  open INTEGER NOT NULL DEFAULT 0,
  solve INTEGER NOT NULL DEFAULT 0,
  autofill_start INTEGER NOT NULL DEFAULT 0,
  autofill_submit INTEGER NOT NULL DEFAULT 0,
  club_start INTEGER NOT NULL DEFAULT 0,
  club_answer INTEGER NOT NULL DEFAULT 0,
  calc_open INTEGER NOT NULL DEFAULT 0,
  bookwork_auto INTEGER NOT NULL DEFAULT 0,
  ai_error INTEGER NOT NULL DEFAULT 0,
  stop_keyboard INTEGER NOT NULL DEFAULT 0,
  stop_no_card INTEGER NOT NULL DEFAULT 0,
  stop_no_box INTEGER NOT NULL DEFAULT 0,
  stop_wrong INTEGER NOT NULL DEFAULT 0,
  stop_picture INTEGER NOT NULL DEFAULT 0,
  stop_error INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, id)
) WITHOUT ROWID;
