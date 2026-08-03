CREATE TABLE IF NOT EXISTS "changelog_categories" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "color" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "changelog_products" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "changelog_categories_slug_idx"
  ON "changelog_categories" USING btree ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "changelog_products_slug_idx"
  ON "changelog_products" USING btree ("slug");

ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "category_id" uuid;
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "product_id" uuid;

DO $$ BEGIN
  ALTER TABLE "changelog_entries"
    ADD CONSTRAINT "changelog_entries_category_id_changelog_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."changelog_categories"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "changelog_entries"
    ADD CONSTRAINT "changelog_entries_product_id_changelog_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."changelog_products"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "changelog_category_id_idx"
  ON "changelog_entries" USING btree ("category_id");
CREATE INDEX IF NOT EXISTS "changelog_product_id_idx"
  ON "changelog_entries" USING btree ("product_id");
