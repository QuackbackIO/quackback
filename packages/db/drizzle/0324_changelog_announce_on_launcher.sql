-- @contract: additive
-- Whether the widget's "What's new" card above the launcher may announce this
-- changelog entry, when the workspace announces new entries there. On by
-- default, so existing and new entries keep being announced; an entry with it
-- off still counts as unread and still shows in the widget's changelog.
ALTER TABLE "changelog_entries"
  ADD COLUMN IF NOT EXISTS "announce_on_launcher" boolean NOT NULL DEFAULT true;
