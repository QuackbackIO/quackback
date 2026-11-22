-- @contract: additive
-- The portal header reads header_display_name and header_display_mode again,
-- through the new Customise editor. Values saved under the old branding page
-- went unread for months, so showing them now would put an old name or an old
-- wordmark back in the header without anyone choosing it. Clear them once:
-- the header name goes back to the workspace name, and the display mode goes
-- back to the square logo and name. header_logo_key is kept (it is still a
-- fallback logo elsewhere), and a dark wordmark only shows in 'custom_logo'
-- mode, so neither needs clearing.
--
-- The column comment written in the same block marks this database as done,
-- so a second run leaves values saved afterwards alone, including rows
-- created after the first run.
-- @replay: guarded-by the header_display_name column comment; once it is written the block does nothing
DO $$
BEGIN
  IF col_description('settings'::regclass, (
    SELECT attnum FROM pg_attribute
    WHERE attrelid = 'settings'::regclass AND attname = 'header_display_name'
  )) IS DISTINCT FROM 'Header name set through the portal Customise editor. Values saved before migration 0323 were cleared.' THEN
    UPDATE "settings"
    SET "header_display_name" = NULL,
        "header_display_mode" = 'logo_and_name'
    WHERE "header_display_name" IS NOT NULL
       OR "header_display_mode" IS DISTINCT FROM 'logo_and_name';
    COMMENT ON COLUMN "settings"."header_display_name" IS
      'Header name set through the portal Customise editor. Values saved before migration 0323 were cleared.';
  END IF;
END $$;
