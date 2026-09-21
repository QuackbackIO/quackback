-- @contract: safe-after 0.13.3
-- Minimum writer release is the release containing this forward-only implementation.
-- Offline replacement only: stop all previous writers before applying. No mixed-version support.
-- See docs/integration-sync-safety.md.
ALTER TABLE post_external_links ADD COLUMN IF NOT EXISTS sync_scope text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE ticket_external_links ADD COLUMN IF NOT EXISTS sync_scope text NOT NULL DEFAULT '';
--> statement-breakpoint
-- @replay: guarded-by replacing only the old three-column unique constraint; the four-column replacement is added only when absent
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'post_external_links'::regclass AND conname = 'post_external_links_type_external_post_unique' AND array_length(conkey, 1) = 3) THEN
    ALTER TABLE post_external_links DROP CONSTRAINT post_external_links_type_external_post_unique;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'post_external_links'::regclass AND conname = 'post_external_links_type_external_post_unique') THEN
    ALTER TABLE post_external_links ADD CONSTRAINT post_external_links_type_external_post_unique UNIQUE (external_id, integration_type, post_id, sync_scope);
  END IF;
END $$;
--> statement-breakpoint
-- @replay: guarded-by replacing only the old three-column unique constraint; the four-column replacement is added only when absent
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ticket_external_links'::regclass AND conname = 'ticket_external_links_type_external_ticket_unique' AND array_length(conkey, 1) = 3) THEN
    ALTER TABLE ticket_external_links DROP CONSTRAINT ticket_external_links_type_external_ticket_unique;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ticket_external_links'::regclass AND conname = 'ticket_external_links_type_external_ticket_unique') THEN
    ALTER TABLE ticket_external_links ADD CONSTRAINT ticket_external_links_type_external_ticket_unique UNIQUE (external_id, integration_type, sync_scope, ticket_id);
  END IF;
END $$;
