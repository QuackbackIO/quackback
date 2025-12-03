-- Enable pg_cron extension for scheduled token cleanup
-- This migration gracefully handles the case where pg_cron is not available

DO $outer$
BEGIN
  -- Try to create the pg_cron extension
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Schedule cleanup of expired session transfer tokens every hour
  -- Job name: 'cleanup-expired-tokens'
  PERFORM cron.schedule(
    'cleanup-expired-tokens',
    '0 * * * *',
    'DELETE FROM session_transfer_token WHERE expires_at < NOW()'
  );

  RAISE NOTICE 'pg_cron enabled: scheduled cleanup-expired-tokens job';

EXCEPTION
  WHEN OTHERS THEN
    -- pg_cron not available (common on local dev or some managed providers)
    -- This is fine - tokens have short TTLs (60s) and unused tokens are harmless
    RAISE NOTICE 'pg_cron not available: %. Token cleanup will not be automated.', SQLERRM;
END
$outer$;

-- Add an index on expires_at to speed up cleanup queries
CREATE INDEX IF NOT EXISTS session_transfer_token_expires_at_idx
ON session_transfer_token (expires_at);
