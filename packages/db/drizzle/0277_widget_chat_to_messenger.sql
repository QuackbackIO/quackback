-- Rewrite leftover 0.13.x widget `chat` keys onto `messenger`, and copy
-- canned replies that still live under `chat` into macros. 0146 already
-- imported messenger.cannedReplies, so this INSERT reads only the leftover
-- chat array and skips any reply that is also listed under messenger. A
-- live-macro name+body check cannot prove that: if an admin later edited
-- or soft-deleted the 0146 row, the stale chat copy would look new.
-- Chat-only replies still skip a live name+body match, including one later
-- scoped to feedback or both.
--
-- Messenger keys win on conflict; chat fills gaps. tabs.messenger is copied
-- from tabs.chat only when it was never stored. The leftover chat keys are
-- dropped so a second run matches zero rows.
--
-- widget_config is text and a corrupt row is tolerated by parseWidgetConfig
-- and by 0196. A hard ::jsonb cast on every settings row would abort the
-- whole upgrade for one bad blob, even when that row has no leftover chat
-- keys. This reader returns NULL on empty or invalid JSON so those rows
-- are skipped.

CREATE OR REPLACE FUNCTION pg_temp._m0277_widget_json(settings_id uuid, raw text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  IF raw IS NULL OR btrim(raw) IN ('', 'null') THEN
    RETURN NULL;
  END IF;
  RETURN raw::jsonb;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'settings row % has invalid widget_config JSON; skipping chat-to-messenger rewrite', settings_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- @replay: guarded-by leftover widget_config chat keys and macros of the same name and body
DO $$
BEGIN
  INSERT INTO "macros" ("id", "name", "body", "scope", "actions", "created_at", "updated_at")
  SELECT gen_random_uuid(), cr->>'title', cr->>'body', 'support', '[]'::jsonb, now(), now()
  FROM "settings" s
  CROSS JOIN LATERAL (
    SELECT pg_temp._m0277_widget_json(s.id, s.widget_config) AS cfg
  ) parsed
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(parsed.cfg#>'{chat,cannedReplies}') = 'array'
        THEN parsed.cfg#>'{chat,cannedReplies}'
      ELSE '[]'::jsonb
    END
  ) AS cr
  WHERE coalesce(cr->>'title', '') <> ''
    AND coalesce(cr->>'body', '') <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(parsed.cfg#>'{messenger,cannedReplies}') = 'array'
            THEN parsed.cfg#>'{messenger,cannedReplies}'
          ELSE '[]'::jsonb
        END
      ) AS mr
      WHERE mr->>'title' = cr->>'title'
        AND mr->>'body' = cr->>'body'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "macros" m
      WHERE m.deleted_at IS NULL
        AND m.name = cr->>'title'
        AND m.body = cr->>'body'
    );

  UPDATE "settings" AS s
  SET "widget_config" = r.rewritten
  FROM (
    SELECT
      src.id,
      (
        (src.cfg - 'chat')
        || jsonb_build_object('messenger', src.messenger)
        || jsonb_build_object('tabs', src.tabs)
      )::text AS rewritten
    FROM (
      SELECT
        id,
        cfg,
        (
          CASE
            WHEN jsonb_typeof(merged->'cannedReplies') = 'array'
              AND jsonb_array_length(merged->'cannedReplies') = 0
              AND jsonb_typeof(cfg#>'{chat,cannedReplies}') = 'array'
              AND jsonb_array_length(cfg#>'{chat,cannedReplies}') > 0
              THEN jsonb_set(merged, '{cannedReplies}', cfg#>'{chat,cannedReplies}')
            ELSE merged
          END
        ) - 'preChatEmail' AS messenger,
        (coalesce(cfg->'tabs', '{}'::jsonb) - 'chat')
          || CASE
            WHEN (cfg#>'{tabs,messenger}') IS NULL
              AND (cfg#>'{tabs,chat}') IS NOT NULL
              THEN jsonb_build_object('messenger', cfg#>'{tabs,chat}')
            ELSE '{}'::jsonb
          END AS tabs
      FROM (
        SELECT
          id,
          cfg,
          CASE
            WHEN jsonb_typeof(cfg->'chat') = 'object'
              THEN (cfg->'chat') || CASE
                WHEN jsonb_typeof(cfg->'messenger') = 'object' THEN cfg->'messenger'
                ELSE '{}'::jsonb
              END
            WHEN jsonb_typeof(cfg->'messenger') = 'object' THEN cfg->'messenger'
            ELSE coalesce(cfg->'messenger', '{}'::jsonb)
          END AS merged
        FROM (
          SELECT id, pg_temp._m0277_widget_json(id, widget_config) AS cfg
          FROM "settings"
        ) parsed
        WHERE jsonb_typeof(parsed.cfg) = 'object'
          AND (
            parsed.cfg ? 'chat'
            OR parsed.cfg#>'{tabs,chat}' IS NOT NULL
          )
      ) built
    ) src
  ) r
  WHERE s.id = r.id;
END $$;
