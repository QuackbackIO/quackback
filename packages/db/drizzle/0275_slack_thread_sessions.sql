-- @contract: additive
CREATE TABLE IF NOT EXISTS slack_thread_sessions (
  slack_team_id text NOT NULL,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  status text NOT NULL,
  last_speaker text NOT NULL,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slack_team_id, channel_id, thread_ts)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS slack_thread_sessions_last_event_idx ON slack_thread_sessions (last_event_at);
