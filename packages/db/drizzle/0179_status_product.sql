-- Status page product (Status Product Spec §5): components + groups, a
-- discriminated incidents/maintenance table with its public update timeline,
-- an append-only component status-event log (uptime bars derive from it),
-- principal-based subscriptions, and incident templates.
CREATE TABLE "status_component_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'operational' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"show_uptime" boolean DEFAULT true NOT NULL,
	"segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_component_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"component_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"incident_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"impact" text DEFAULT 'none' NOT NULL,
	"impact_override" boolean DEFAULT false NOT NULL,
	"scheduled_start_at" timestamp with time zone,
	"scheduled_end_at" timestamp with time zone,
	"auto_start" boolean DEFAULT true NOT NULL,
	"auto_complete" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"backfilled" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_incident_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_incident_components" (
	"incident_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"component_status" text NOT NULL,
	CONSTRAINT "status_incident_components_incident_id_component_id_pk" PRIMARY KEY("incident_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "status_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"scope" text DEFAULT 'page' NOT NULL,
	"component_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_incident_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"impact" text DEFAULT 'minor' NOT NULL,
	"component_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status_components" ADD CONSTRAINT "status_components_group_id_status_component_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."status_component_groups"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_component_events" ADD CONSTRAINT "status_component_events_component_id_status_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."status_components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_incidents" ADD CONSTRAINT "status_incidents_created_by_principal_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_incident_id_status_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."status_incidents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_created_by_principal_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_incident_components" ADD CONSTRAINT "status_incident_components_incident_id_status_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."status_incidents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_incident_components" ADD CONSTRAINT "status_incident_components_component_id_status_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."status_components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_subscriptions" ADD CONSTRAINT "status_subscriptions_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "status_components_group_idx" ON "status_components" USING btree ("group_id");
--> statement-breakpoint
CREATE INDEX "status_components_deleted_at_idx" ON "status_components" USING btree ("deleted_at");
--> statement-breakpoint
CREATE INDEX "status_component_events_component_idx" ON "status_component_events" USING btree ("component_id","created_at");
--> statement-breakpoint
CREATE INDEX "status_incidents_kind_status_idx" ON "status_incidents" USING btree ("kind","status");
--> statement-breakpoint
CREATE INDEX "status_incidents_started_at_idx" ON "status_incidents" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "status_incidents_deleted_at_idx" ON "status_incidents" USING btree ("deleted_at");
--> statement-breakpoint
CREATE INDEX "status_incident_updates_incident_idx" ON "status_incident_updates" USING btree ("incident_id","created_at");
--> statement-breakpoint
CREATE INDEX "status_incident_components_component_idx" ON "status_incident_components" USING btree ("component_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscriptions_principal_idx" ON "status_subscriptions" USING btree ("principal_id");
