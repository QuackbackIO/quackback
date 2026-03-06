CREATE TABLE "slack_channel_monitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"channel_name" text NOT NULL,
	"board_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_monitor_channel_unique" UNIQUE("integration_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "slack_channel_monitors" ADD CONSTRAINT "slack_channel_monitors_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_channel_monitors" ADD CONSTRAINT "slack_monitors_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_slack_monitors_lookup" ON "slack_channel_monitors" USING btree ("integration_id","channel_id","enabled");
