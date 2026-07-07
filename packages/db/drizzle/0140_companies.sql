-- B2B company object (support platform §4.4). People and (later) tickets link
-- to a company so agents see plan / MRR context inline in the inbox. Additive:
-- principal gains a nullable company_id soft-owned FK (set null on delete) so a
-- company can be removed without orphaning its people.
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"external_id" text,
	"plan" text,
	"mrr_cents" integer,
	"custom_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One company per email domain, case-insensitive. Partial so unset domains
-- never collide.
CREATE UNIQUE INDEX "companies_domain_lower_idx" ON "companies" (LOWER("domain")) WHERE "domain" IS NOT NULL;
--> statement-breakpoint
-- CRM linkage id, unique when present.
CREATE UNIQUE INDEX "companies_external_id_idx" ON "companies" ("external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "principal" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "principal"
	ADD CONSTRAINT "principal_company_id_companies_id_fk"
	FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Company -> people lookups (sidebar roster, member counts).
CREATE INDEX "principal_company_id_idx" ON "principal" ("company_id") WHERE "company_id" IS NOT NULL;
--> statement-breakpoint
-- Companies directory (§K2): the qualification standard fields both the inbox
-- sidebar editor and the profile edit, plus the record-origin discriminator.
-- ONE record type with a source column ('api' | 'manual') — never a separate
-- "qualification company" shadow object.
ALTER TABLE "companies" ADD COLUMN "size" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "website" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "industry" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "source" text DEFAULT 'api' NOT NULL;
--> statement-breakpoint
-- Company attribute definitions: admin-defined custom attributes mapping to
-- keys in companies.custom_attributes. Mirrors user_attribute_definitions
-- exactly (text id holding the UUID form, same columns, same unique key).
CREATE TABLE "company_attribute_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"currency_code" text,
	"external_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "company_attr_key_idx" ON "company_attribute_definitions" USING btree ("key");
