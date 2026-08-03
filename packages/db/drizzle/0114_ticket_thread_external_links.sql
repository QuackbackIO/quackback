-- Ticket thread external comment links.
--
-- Durable correlation between Quackback ticket threads and external issue
-- comments. This powers two-way comment sync, webhook idempotency, and manual
-- backfill without overloading ticket_external_links, which represents issue
-- links rather than per-comment links.

CREATE TABLE IF NOT EXISTS "ticket_thread_external_links" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ticket_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "integration_type" varchar(50) NOT NULL,
  "external_issue_id" text NOT NULL,
  "external_comment_id" text NOT NULL,
  "external_url" text,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "sync_direction" varchar(20) DEFAULT 'outbound' NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_thread_external_links"
  ADD CONSTRAINT "ticket_thread_external_links_ticket_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_thread_external_links"
  ADD CONSTRAINT "ticket_thread_external_links_thread_fk"
  FOREIGN KEY ("thread_id") REFERENCES "public"."ticket_threads"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_thread_external_links"
  ADD CONSTRAINT "ticket_thread_external_links_integration_fk"
  FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_thread_external_links_integration_comment_unique"
  ON "ticket_thread_external_links" USING btree ("integration_id", "external_comment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_thread_external_links_integration_thread_unique"
  ON "ticket_thread_external_links" USING btree ("integration_id", "thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_thread_external_links_ticket_idx"
  ON "ticket_thread_external_links" USING btree ("ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_thread_external_links_issue_idx"
  ON "ticket_thread_external_links" USING btree ("integration_id", "external_issue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_thread_external_links_thread_status_idx"
  ON "ticket_thread_external_links" USING btree ("thread_id", "status");
--> statement-breakpoint

-- Existing GitHub ticket-sync connections should start syncing public replies
-- without requiring admins to rediscover and save the integration settings.
-- Copy the first existing enabled ticket-event inbox filter so new comment
-- mappings respect the same repository scoping.
INSERT INTO "integration_event_mappings" (
  "id",
  "integration_id",
  "event_type",
  "action_type",
  "action_config",
  "filters",
  "target_key",
  "enabled",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  i."id",
  e."event_type",
  'send_message',
  '{}'::jsonb,
  existing_ticket_mapping."filters",
  'default',
  true,
  now(),
  now()
FROM "integrations" i
JOIN LATERAL (
  SELECT m."filters"
  FROM "integration_event_mappings" m
  WHERE m."integration_id" = i."id"
    AND m."enabled" = true
    AND m."event_type" IN (
      'ticket.created',
      'ticket.status_changed',
      'ticket.assigned',
      'ticket.updated'
    )
  ORDER BY m."created_at" ASC
  LIMIT 1
) existing_ticket_mapping ON true
CROSS JOIN (
  VALUES
    ('ticket.thread_added'),
    ('ticket.thread_updated'),
    ('ticket.thread_deleted')
) AS e("event_type")
WHERE i."integration_type" = 'github'
  AND i."status" = 'active'
  AND COALESCE(i."config"->>'syncDirection', 'outbound') IN ('outbound', 'bidirectional')
ON CONFLICT ("integration_id", "event_type", "action_type", "target_key") DO NOTHING;
