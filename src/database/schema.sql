CREATE TABLE IF NOT EXISTS notes (
  note_key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS device_analytics (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  first_seen DATETIME NOT NULL,
  last_active DATETIME NOT NULL,
  notes_created INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS analytics_access_logs (
  id TEXT PRIMARY KEY,
  attempt_time DATETIME NOT NULL,
  status TEXT NOT NULL,
  device_name TEXT NOT NULL,
  verification_step TEXT NOT NULL
);
