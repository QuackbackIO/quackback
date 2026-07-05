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
