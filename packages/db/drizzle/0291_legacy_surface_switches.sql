-- Carry the retired Help Center and Messenger master switches onto the
-- controls that replaced them, so an upgrade never publishes a surface the
-- workspace had switched off.
--
-- Before the switches were dropped, the public Help Center needed the
-- `helpCenter` product flag AND `help_center_config.enabled`, and the widget
-- Messenger needed the `supportInbox` flag, `tabs.messenger` AND
-- `messenger.enabled` (stored as `chat.enabled` until 0277). The app now
-- gates on the flag and the tab alone, so a workspace that kept either
-- switch off would see published articles, or the Messenger tab, go live.
--
-- Only feature_flags blobs written before the switches were dropped are
-- touched. Every flag write since then stores the `feedback` key (the
-- product-flag shape), while older releases never stored it, so a blob
-- without `feedback` still holds the values its workspace chose under the
-- two-switch rules. Workspaces that set their flags under the current
-- rules keep them.
--
-- - Help Center: flag on and `enabled` not true (an absent config read as
--   off) turns the flag off. Articles stay; Settings, General turns it back on.
-- - Messenger: inbox flag on, Messages tab on and `messenger.enabled` not
--   true turns the widget Messages tab off. The inbox, email and portal
--   support keep running.
--
-- Last, every pre-switch blob is rewritten to the current shape by adding
-- `feedback: true` (the value read time already forces). That closes the
-- selector, so a replay matches nothing.
--
-- The settings columns are text. A hard ::jsonb cast would abort the whole
-- upgrade on one corrupt blob, so this reader returns NULL for empty,
-- invalid or non-object JSON and those rows are skipped (the app reads them
-- as defaults: both surfaces off).

CREATE OR REPLACE FUNCTION pg_temp._m0291_json_object(raw text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  parsed jsonb;
BEGIN
  IF raw IS NULL OR btrim(raw) IN ('', 'null') THEN
    RETURN NULL;
  END IF;
  parsed := raw::jsonb;
  IF jsonb_typeof(parsed) <> 'object' THEN
    RETURN NULL;
  END IF;
  RETURN parsed;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- @replay: guarded-by feature_flags blobs that lack the `feedback` key; the last UPDATE adds it to every such blob, so a second run selects no rows and the cache DELETE does not run
DO $$
DECLARE
  touched integer := 0;
  n integer;
BEGIN
  UPDATE "settings" AS s
  SET "feature_flags" = jsonb_set(p.flags, '{helpCenter}', 'false'::jsonb)::text
  FROM (
    SELECT
      id,
      pg_temp._m0291_json_object(feature_flags) AS flags,
      pg_temp._m0291_json_object(help_center_config) AS hc
    FROM "settings"
  ) p
  WHERE s.id = p.id
    AND NOT (p.flags ? 'feedback')
    AND p.flags -> 'helpCenter' = 'true'::jsonb
    AND (p.hc -> 'enabled') IS DISTINCT FROM 'true'::jsonb;
  GET DIAGNOSTICS n = ROW_COUNT;
  touched := touched + n;

  UPDATE "settings" AS s
  SET "widget_config" = jsonb_set(p.widget, '{tabs,messenger}', 'false'::jsonb)::text
  FROM (
    SELECT
      id,
      pg_temp._m0291_json_object(feature_flags) AS flags,
      pg_temp._m0291_json_object(widget_config) AS widget
    FROM "settings"
  ) p
  WHERE s.id = p.id
    AND NOT (p.flags ? 'feedback')
    AND p.flags -> 'supportInbox' = 'true'::jsonb
    AND jsonb_typeof(p.widget -> 'tabs') = 'object'
    AND p.widget #> '{tabs,messenger}' = 'true'::jsonb
    AND (p.widget #> '{messenger,enabled}') IS DISTINCT FROM 'true'::jsonb;
  GET DIAGNOSTICS n = ROW_COUNT;
  touched := touched + n;

  UPDATE "settings" AS s
  SET "feature_flags" = (p.flags || '{"feedback":true}'::jsonb)::text
  FROM (
    SELECT id, pg_temp._m0291_json_object(feature_flags) AS flags
    FROM "settings"
  ) p
  WHERE s.id = p.id
    AND NOT (p.flags ? 'feedback');
  GET DIAGNOSTICS n = ROW_COUNT;
  touched := touched + n;

  IF touched > 0 THEN
    DELETE FROM "kv_store" WHERE "key" = 'settings:workspace';
  END IF;
END $$;
