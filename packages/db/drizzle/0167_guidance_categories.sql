-- Guidance-rule categories (communication style, context/clarification,
-- content/sources, spam, other) group the admin guidance list; existing rows
-- default to "other". App-validated against the fixed catalogue rather than a
-- DB CHECK, so the catalogue can grow without an enum migration.
ALTER TABLE "assistant_guidance_rules" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;
--> statement-breakpoint
CREATE INDEX "assistant_guidance_rules_category_position_idx" ON "assistant_guidance_rules" USING btree ("category","position");
