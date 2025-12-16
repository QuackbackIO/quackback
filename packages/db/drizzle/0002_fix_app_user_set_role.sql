-- PostgreSQL 16+ requires explicit SET option for role membership to allow SET ROLE
-- This fixes: "permission denied to set role app_user"
-- Using DO block to grant to current user dynamically
DO $$
BEGIN
  EXECUTE format('GRANT app_user TO %I WITH SET TRUE', current_user);
END $$;
