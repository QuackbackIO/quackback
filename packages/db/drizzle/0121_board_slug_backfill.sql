-- Heal boards whose slug was emptied by renaming them to a name that
-- slugifies to nothing (CJK scripts, emoji, etc.). An empty slug crashes
-- the slug-keyed board <Select.Item> on the widget settings page and makes
-- the board unselectable across the admin UI (#285). The service paths are
-- fixed going forward; this repairs already-broken rows.
--
-- The slug column is NOT NULL UNIQUE, so at most one row can hold ''. We
-- derive the replacement from the (unique) id so it can never collide.
-- Idempotent: only touches empty slugs.

UPDATE "boards"
SET "slug" = 'board-' || "id"::text
WHERE "slug" = '';
