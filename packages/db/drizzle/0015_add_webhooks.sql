-- Webhooks table for external event notifications
-- Webhook endpoints are triggered when events occur in Quackback

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  created_by_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT[] NOT NULL,
  board_ids TEXT[],
  status TEXT NOT NULL DEFAULT 'active',
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for finding active webhooks
CREATE INDEX IF NOT EXISTS webhooks_status_idx ON webhooks(status);

-- Index for listing webhooks by creator
CREATE INDEX IF NOT EXISTS webhooks_created_by_id_idx ON webhooks(created_by_id);
