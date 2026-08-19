-- Remove the AI feedback-extraction subsystem (labs-only, never left experimental).
--
-- Drops the feedback ingestion/extraction pipeline tables, the Slack channel
-- monitor table, the external-user identity map, and the pipeline debug log.
-- CASCADE clears the incoming foreign keys (pipeline_log → feedback tables,
-- and the post_votes.feedback_suggestion_id provenance column dropped below).
--
-- The shared ai_usage_log table is retained; its now-unused raw_feedback_item_id
-- and signal_id columns stay as harmless nullable attribution fields.

-- Provenance column on post_votes that referenced feedback_suggestions.
DROP INDEX IF EXISTS "post_votes_feedback_suggestion_idx";
ALTER TABLE "post_votes" DROP COLUMN IF EXISTS "feedback_suggestion_id";

-- Feedback pipeline debug log (feedback-only; FKs into the tables below).
DROP TABLE IF EXISTS "pipeline_log" CASCADE;

-- Feedback ingestion + extraction pipeline.
DROP TABLE IF EXISTS "feedback_signals" CASCADE;
DROP TABLE IF EXISTS "feedback_suggestions" CASCADE;
DROP TABLE IF EXISTS "raw_feedback_items" CASCADE;
DROP TABLE IF EXISTS "feedback_sources" CASCADE;

-- External identity map used only by the pipeline's import attribution.
DROP TABLE IF EXISTS "external_user_mappings" CASCADE;

-- Slack channel monitoring (fed the ingestion pipeline).
DROP TABLE IF EXISTS "slack_channel_monitors" CASCADE;
