-- Per-channel identity map (support platform §4.1): one principal per external
-- address per channel. Natural composite key, no TypeID. principal_id CASCADEs
-- and is re-pointed by the anonymous-to-identified merge.
CREATE TABLE "channel_identities" (
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_identities_pkey" PRIMARY KEY ("channel", "external_id")
);
--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "channel_identities_principal_idx" ON "channel_identities" ("principal_id");
--> statement-breakpoint
-- Outbound conversation-email threading: the deterministic Message-ID stamped
-- on each notification email, keyed to its conversation. Powers the References
-- chain on the next send and routes plus-address-stripped replies back home.
CREATE TABLE "conversation_outbound_emails" (
	"message_id" text PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_outbound_emails" ADD CONSTRAINT "conversation_outbound_emails_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "conversation_outbound_emails_conversation_idx" ON "conversation_outbound_emails" ("conversation_id","created_at");
