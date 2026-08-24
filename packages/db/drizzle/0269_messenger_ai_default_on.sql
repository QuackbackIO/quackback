-- Stamp workspaces that never persisted widget/portal JSON so they keep today's
-- off-by-default messenger surfaces after DEFAULT_WIDGET_CONFIG /
-- DEFAULT_PORTAL_CONFIG flip messenger tab, changelog tab, portal chats, and
-- Quinn auto-replies on. Stored keys win; only null/empty blobs get the previous
-- shape. New workspaces omit these columns on insert and pick up the new defaults.
--
-- assistant_config is NOT NULL with a column default, so every existing row
-- already has a blob. Do not rewrite stored Copilot knowledge maps; only the
-- column default changes so inserts after this migration start with tickets
-- and changelog on.
--
-- The UPDATEs sit in a DO block so a fleet replay is a no-op. Each write fires
-- only while the column is still null or empty; a stored blob makes the WHERE
-- match nothing. A bare UPDATE would collapse the gap-heal window.

-- @replay: guarded-by widget_config and portal_config still being null or empty; stored blobs are left untouched
DO $$
BEGIN
  UPDATE "settings"
  SET "widget_config" = '{"enabled":false,"tabs":{"feedback":true,"changelog":false,"messenger":false,"home":true},"messenger":{"enabled":false,"welcomeMessage":"Hi! 👋 How can we help you today?","offlineMessage":"We''re away right now. Leave a message and we''ll get back to you by email.","assistant":{"enabled":true,"respond":false}}}'
  WHERE "widget_config" IS NULL
     OR btrim("widget_config") IN ('', 'null');

  UPDATE "settings"
  SET "portal_config" = '{"features":{"allowEditAfterEngagement":false,"allowDeleteAfterEngagement":false,"showPublicEditHistory":false,"allowAnonymous":true},"welcomeCard":{"body":{"type":"doc","content":[{"type":"paragraph"}]}},"moderationDefault":{"requireApproval":"none","holdImages":false,"holdLinks":false},"access":{"visibility":"public","allowedDomains":[],"widgetSignIn":false,"allowedSegmentIds":[]},"support":{"enabled":false}}'
  WHERE "portal_config" IS NULL
     OR btrim("portal_config") IN ('', 'null');
END $$;

ALTER TABLE "settings" ALTER COLUMN "assistant_config" SET DEFAULT '{"version":3,"identity":{"name":"Quinn","avatarUrl":null},"agents":{"agent":{"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""},"knowledge":{"helpCenter":true,"posts":false,"changelog":false,"documents":true,"status":false},"toolRules":{}},"copilot":{"capabilities":{"qa":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":true,"changelog":true,"documents":true,"status":true},"toolRules":{}}}}'::jsonb;
