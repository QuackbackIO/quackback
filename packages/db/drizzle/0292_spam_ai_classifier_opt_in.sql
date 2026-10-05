-- The AI spam classifier sends the first message of every new email and
-- Messenger conversation to the configured model, and filed spam is deleted
-- after 30 days. Existing workspaces opt in from Settings rather than gain
-- it on upgrade: every settings row present now stores `aiClassifier: false`.
-- New workspaces keep the classifier on through the column default below
-- (read time also treats an absent key as on).
--
-- spam_filter_config is text. Rows with empty, invalid or non-object JSON
-- already read as "no trust list", so they are replaced by the off switch
-- alone. Object rows keep their trust list and gain the key.
--
-- The column default is set after the stamp so rows created later carry an
-- explicit `aiClassifier: true` and a replay of the stamp matches nothing.

CREATE OR REPLACE FUNCTION pg_temp._m0292_json_object(raw text)
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

-- @replay: guarded-by spam_filter_config rows without an aiClassifier key; this run gives every existing row one and the default below gives every new row one, so a second run selects nothing and the cache DELETE does not run
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE "settings" AS s
  SET "spam_filter_config" =
    (coalesce(p.cfg, '{}'::jsonb) || '{"aiClassifier":false}'::jsonb)::text
  FROM (
    SELECT id, pg_temp._m0292_json_object(spam_filter_config) AS cfg
    FROM "settings"
  ) p
  WHERE s.id = p.id
    AND (p.cfg IS NULL OR NOT (p.cfg ? 'aiClassifier'));
  GET DIAGNOSTICS n = ROW_COUNT;

  IF n > 0 THEN
    DELETE FROM "kv_store" WHERE "key" = 'settings:workspace';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "settings" ALTER COLUMN "spam_filter_config" SET DEFAULT '{"trustedSenders":[],"aiClassifier":true}';
