-- @contract: additive
-- The domains a workspace has added by name, each with an ownership record of
-- its own.
--
-- A domain is added by its name only. What it is used for (email sending, a
-- custom domain, sign-in) stays in the tables that own each use, which join to
-- this one by name: there are no foreign keys. The Domains list is the union of
-- these rows and the names the uses already hold, so nothing is backfilled.
--
-- `ownership_token` is minted for the row (never derived from its name) and is
-- published as `_quackback` TXT `quackback-domain-verification=<token>`. Only
-- finding that exact value moves a row to `verified`; `pending` proves nothing.
CREATE TABLE IF NOT EXISTS "domains" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "ownership_token" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'verified')),
  "verified_at" timestamp with time zone,
  "last_checked_at" timestamp with time zone,
  "ownership_missing_since" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "domains_name_unique" UNIQUE ("name")
);
