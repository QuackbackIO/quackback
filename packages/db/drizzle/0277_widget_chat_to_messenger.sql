-- Rewrite leftover 0.13.x widget `chat` keys onto `messenger`, then copy
-- canned replies into macros. 0146 only read messenger.cannedReplies, so a
-- straight 0.13.2 upgrade would otherwise keep welcome copy, office hours,
-- and saved replies on a key the app no longer reads.
--
-- Messenger keys win on conflict; chat fills gaps. tabs.messenger is copied
-- from tabs.chat only when it was never stored. The leftover chat keys are
-- dropped so a second run matches zero rows. The INSERT skips a name+body
-- that 0146 (or a previous apply) already copied.

-- @replay: guarded-by leftover widget_config chat keys and macros of the same name and body
DO $$
BEGIN
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
          SELECT id, widget_config::jsonb AS cfg
          FROM "settings"
          WHERE widget_config IS NOT NULL
            AND btrim(widget_config) NOT IN ('', 'null')
            AND (
              widget_config::jsonb ? 'chat'
              OR (widget_config::jsonb)#>'{tabs,chat}' IS NOT NULL
            )
        ) parsed
      ) built
    ) src
  ) r
  WHERE s.id = r.id;

  INSERT INTO "macros" ("id", "name", "body", "scope", "actions", "created_at", "updated_at")
  SELECT gen_random_uuid(), cr->>'title', cr->>'body', 'support', '[]'::jsonb, now(), now()
  FROM "settings" s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN s.widget_config IS NULL OR btrim(s.widget_config) IN ('', 'null') THEN '[]'::jsonb
      WHEN jsonb_typeof((s.widget_config::jsonb)#>'{messenger,cannedReplies}') = 'array'
        THEN (s.widget_config::jsonb)#>'{messenger,cannedReplies}'
      ELSE '[]'::jsonb
    END
  ) AS cr
  WHERE coalesce(cr->>'title', '') <> ''
    AND coalesce(cr->>'body', '') <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM "macros" m
      WHERE m.deleted_at IS NULL
        AND m.name = cr->>'title'
        AND m.body = cr->>'body'
        AND m.scope = 'support'
    );
END $$;
