-- Automatic website branding is for new workspaces only. Every workspace that
-- already exists counts as looked up, so its live portal logo and colors never
-- change after an upgrade. A metadata bag that is not a JSON object is left as
-- it is; the lookup refuses to claim such a bag too.
-- @replay: guarded-by the brandingLookup key already existing; a row that carries it is skipped
DO $$
DECLARE
  r record;
  bag jsonb;
BEGIN
  FOR r IN SELECT "id", "metadata" FROM "settings" LOOP
    BEGIN
      bag := CASE
        WHEN r."metadata" IS NULL OR btrim(r."metadata") = '' THEN '{}'::jsonb
        ELSE r."metadata"::jsonb
      END;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF bag = 'null'::jsonb THEN
      bag := '{}'::jsonb;
    END IF;
    CONTINUE WHEN jsonb_typeof(bag) <> 'object' OR bag ? 'brandingLookup';
    UPDATE "settings"
    SET "metadata" = (bag || jsonb_build_object(
      'brandingLookup',
      jsonb_build_object(
        'version', 1,
        'status', 'skipped',
        'reason', 'existing',
        'completedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ))::text
    WHERE "id" = r."id";
  END LOOP;
END $$;
