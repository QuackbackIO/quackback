-- @contract: additive
-- Replies sent through a personal API key count as the key creator's replies,
-- but only for keys made from this release on. Every key older than API key
-- kinds was marked personal, and integrations built on those keys expect their
-- replies to stay automated. So the time this database reaches this release is
-- recorded once, as the cutoff the shared reply rule reads
-- (apps/web/src/lib/server/messages/reply-rule.ts): a personal key created at
-- or after it is a person, and an older one stays automated.
--
-- Stored in kv_store under its own key. Each workspace has its own database,
-- so the readers match the key alone. kv rows always expire; this one is set
-- a hundred years out.
-- @replay: guarded-by the row's primary key; ON CONFLICT DO NOTHING keeps the first cutoff, so a replay never moves it
DO $$
BEGIN
  INSERT INTO "kv_store" ("workspace_key", "key", "value", "expires_at")
  VALUES ('_', 'api-keys:personal-reply-cutoff', to_jsonb(now()), now() + interval '100 years')
  ON CONFLICT ("workspace_key", "key") DO NOTHING;
END $$;
