-- AI Usage Log: one row per API call, append-only cost ledger.
-- No foreign keys — plain UUID references for cost attribution without coupling.
CREATE TABLE ai_usage_log (
  id              uuid PRIMARY KEY,
  pipeline_step   varchar(30) NOT NULL,
  call_type       varchar(20) NOT NULL,
  model           varchar(100) NOT NULL,

  raw_feedback_item_id  uuid,
  signal_id             uuid,
  post_id               uuid,

  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer,
  total_tokens    integer NOT NULL DEFAULT 0,

  duration_ms     integer NOT NULL,
  retry_count     integer NOT NULL DEFAULT 0,

  status          varchar(10) NOT NULL DEFAULT 'success',
  error           text,

  metadata        jsonb,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_log_step_idx ON ai_usage_log (pipeline_step);
CREATE INDEX ai_usage_log_created_idx ON ai_usage_log (created_at);
CREATE INDEX ai_usage_log_raw_item_idx ON ai_usage_log (raw_feedback_item_id);

-- Pipeline Audit Log: one row per processing event, chronological audit trail.
-- FKs with ON DELETE SET NULL so rows survive source deletion.
CREATE TABLE pipeline_log (
  id                    uuid PRIMARY KEY,
  event_type            varchar(50) NOT NULL,
  raw_feedback_item_id  uuid REFERENCES raw_feedback_items(id) ON DELETE SET NULL,
  signal_id             uuid REFERENCES feedback_signals(id) ON DELETE SET NULL,
  suggestion_id         uuid REFERENCES feedback_suggestions(id) ON DELETE SET NULL,
  post_id               uuid REFERENCES posts(id) ON DELETE SET NULL,
  detail                jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pipeline_log_raw_item_idx ON pipeline_log (raw_feedback_item_id);
CREATE INDEX pipeline_log_event_type_idx ON pipeline_log (event_type);
CREATE INDEX pipeline_log_created_idx ON pipeline_log (created_at);

-- Structured dismiss reasons on feedback_suggestions.
ALTER TABLE feedback_suggestions
  ADD COLUMN dismiss_reason_code varchar(30),
  ADD COLUMN dismiss_reason_note text;
