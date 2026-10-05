-- Workspace spam-filter configuration (JSON):
-- { trustedSenders: string[], aiClassifier: boolean }.
-- Trusted senders (exact addresses or domains) bypass inbound spam
-- classification entirely. Null means the workspace has no overrides, and
-- an absent aiClassifier reads as on.
--
-- Workspaces that already exist when the column is added opt in to the AI
-- spam classifier from Settings rather than gain it on upgrade, so their
-- rows store it off. A fresh install has no settings rows yet and keeps the
-- read-time default (on).
--
-- @replay: guarded-by the spam_filter_config column not existing yet; once it exists the block does nothing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"settings"'::regclass
      AND attname = 'spam_filter_config'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE "settings" ADD COLUMN "spam_filter_config" text;
    UPDATE "settings" SET "spam_filter_config" = '{"trustedSenders":[],"aiClassifier":false}';
  END IF;
END $$;
