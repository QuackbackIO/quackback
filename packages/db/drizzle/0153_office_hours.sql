-- Office hours + the SLA seam (support platform §4.6). ONE workspace schedule
-- entity (weekly intervals + timezone; an empty intervals array means 24/7,
-- resolved DST-safe at read) consumed by Messenger reply-expectations, the
-- workflows office-hours condition, Quinn handover copy, and SLA clocks. The
-- `conversations.sla_applied` column is the cheap reserved seam (§4.6, "painful
-- to retrofit") for the later SLA slice: the one active policy on a conversation.
CREATE TABLE "office_hours_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"intervals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The workspace has ONE schedule in v1: at most one row may be the default.
CREATE UNIQUE INDEX "office_hours_one_default_uq" ON "office_hours_schedules" ("is_default")
	WHERE "is_default" = true;
--> statement-breakpoint
-- Reserved SLA seam: the one active SLA applied to a conversation, or null.
-- Written by the Apply-SLA workflow action in a later slice.
ALTER TABLE "conversations" ADD COLUMN "sla_applied" jsonb;
