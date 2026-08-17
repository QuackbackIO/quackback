-- Outbound/inbound email ledger. Self-hosters get delivery debugging; the
-- partial index is the month-quota counter for emailsPerMonth.
CREATE TABLE "email_log" (
  "id" text PRIMARY KEY NOT NULL,
  "direction" varchar(16) NOT NULL,
  "email_type" varchar(64) NOT NULL,
  "provider" varchar(32),
  "message_id" text,
  "provider_message_id" text,
  "principal_id" text,
  "address" text NOT NULL,
  "subject" text,
  "conversation_id" text,
  "ticket_id" text,
  "post_id" text,
  "status" varchar(16) NOT NULL,
  "error" text,
  "billable" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_log_created_idx" ON "email_log" ("created_at");
--> statement-breakpoint
CREATE INDEX "email_log_conversation_idx" ON "email_log" ("conversation_id");
--> statement-breakpoint
CREATE INDEX "email_log_month_billable_idx"
  ON "email_log" ("created_at")
  WHERE "direction" = 'outbound' AND "status" = 'sent' AND "billable" = true;
