-- @contract: additive
-- Each setup email goes to a teammate at most once; the row is the record.
CREATE TABLE IF NOT EXISTS "onboarding_emails" (
  "principal_id" uuid NOT NULL
    CONSTRAINT "onboarding_emails_principal_id_principal_id_fk"
    REFERENCES "principal"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_emails_principal_kind_idx"
  ON "onboarding_emails" ("principal_id", "kind");
