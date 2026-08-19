-- Email channel (support platform §4.8 Layer 2): the connected email channel
-- instances. `channel_accounts` holds two row roles for email — one `inbound`
-- route per workspace (the front door: forwarding target / IMAP mailbox / Resend
-- parse address + inbound secret + provider + the poll cursor, all in `config`)
-- that a conversation's `channel_account_id` points at, and N `sending` addresses
-- (the verified From identities per module) used to pick the outbound From.
-- `email_sending_domains` are the SPF/DKIM-verified domains a sending address
-- belongs to. Inert until the cold-inbound + outbound slices wire them.
CREATE TABLE "email_sending_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owning_team_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A domain is unique per team.
CREATE UNIQUE INDEX "email_sending_domains_team_domain_unique"
	ON "email_sending_domains" ("owning_team_id","domain");
--> statement-breakpoint
-- cascade: a team's sending domains are meaningless without the team.
ALTER TABLE "email_sending_domains"
	ADD CONSTRAINT "email_sending_domains_owning_team_id_fkey"
	FOREIGN KEY ("owning_team_id") REFERENCES "teams"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owning_team_id" uuid NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"role" text NOT NULL,
	"address" text,
	"module" text,
	"sending_domain_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inbound_trust" text DEFAULT 'strict' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "channel_accounts_role_check" CHECK ("role" IN ('inbound','sending')),
	CONSTRAINT "channel_accounts_channel_check" CHECK ("channel" = 'email')
);
--> statement-breakpoint
-- cascade: a team's channel accounts are meaningless without the team.
ALTER TABLE "channel_accounts"
	ADD CONSTRAINT "channel_accounts_owning_team_id_fkey"
	FOREIGN KEY ("owning_team_id") REFERENCES "teams"("id") ON DELETE cascade;
--> statement-breakpoint
-- restrict: a sending domain in use by an address can never be deleted out from under it.
ALTER TABLE "channel_accounts"
	ADD CONSTRAINT "channel_accounts_sending_domain_id_fkey"
	FOREIGN KEY ("sending_domain_id") REFERENCES "email_sending_domains"("id") ON DELETE restrict;
--> statement-breakpoint
-- One inbound route per workspace (v1); relax when multi-inbox lands.
CREATE UNIQUE INDEX "channel_accounts_one_inbound_uq" ON "channel_accounts" ("owning_team_id")
	WHERE "role" = 'inbound' AND "channel" = 'email' AND "deleted_at" IS NULL;
--> statement-breakpoint
-- A sending address is unique per team + channel.
CREATE UNIQUE INDEX "channel_accounts_sending_address_uq"
	ON "channel_accounts" ("owning_team_id","channel","address")
	WHERE "address" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
-- The role resolver + soft-delete filter.
CREATE INDEX "channel_accounts_team_role_idx" ON "channel_accounts" ("owning_team_id","role")
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint
-- The inbox a conversation arrived on (§4.9 constitutive-but-set-null): email
-- conversations point at their inbound route; messenger/web_form leave it null.
ALTER TABLE "conversations" ADD COLUMN "channel_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversations"
	ADD CONSTRAINT "conversations_channel_account_id_fkey"
	FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "conversations_channel_account_id_idx" ON "conversations" ("channel_account_id");
