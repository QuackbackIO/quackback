-- Help center per-article translations (domains/languages §2). Default-locale
-- content stays on kb_articles/kb_categories; every additional locale gets a
-- row here. search_vector keys its tsvector config off THIS row's locale via
-- a static CASE expression (packages/db/src/schema/kb.ts localeRegconfigCaseSql
-- is the single source of truth this is generated from) -- stock Postgres has
-- no CJK tokenizer, so zh-cn/zh-tw fall back to 'simple'. Categories have no
-- status column: a category is "translated" in a locale purely by having a
-- row here with a non-empty name (the homepage visibility gate, §1).
CREATE TABLE "kb_article_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text,
	"content" text DEFAULT '' NOT NULL,
	"content_json" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector(CASE locale WHEN 'de' THEN 'german'::regconfig WHEN 'fr' THEN 'french'::regconfig WHEN 'es' THEN 'spanish'::regconfig WHEN 'ar' THEN 'arabic'::regconfig WHEN 'ru' THEN 'russian'::regconfig WHEN 'pt-br' THEN 'portuguese'::regconfig WHEN 'zh-cn' THEN 'simple'::regconfig WHEN 'zh-tw' THEN 'simple'::regconfig ELSE 'english'::regconfig END, coalesce(title, '')), 'A') || setweight(to_tsvector(CASE locale WHEN 'de' THEN 'german'::regconfig WHEN 'fr' THEN 'french'::regconfig WHEN 'es' THEN 'spanish'::regconfig WHEN 'ar' THEN 'arabic'::regconfig WHEN 'ru' THEN 'russian'::regconfig WHEN 'pt-br' THEN 'portuguese'::regconfig WHEN 'zh-cn' THEN 'simple'::regconfig WHEN 'zh-tw' THEN 'simple'::regconfig ELSE 'english'::regconfig END, coalesce(content, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_category_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_article_translations" ADD CONSTRAINT "kb_article_translations_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kb_category_translations" ADD CONSTRAINT "kb_category_translations_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "kb_article_translations_unique_idx" ON "kb_article_translations" USING btree ("article_id","locale");
--> statement-breakpoint
CREATE INDEX "kb_article_translations_locale_idx" ON "kb_article_translations" USING btree ("locale");
--> statement-breakpoint
CREATE INDEX "kb_article_translations_search_vector_idx" ON "kb_article_translations" USING gin ("search_vector");
--> statement-breakpoint
CREATE UNIQUE INDEX "kb_category_translations_unique_idx" ON "kb_category_translations" USING btree ("category_id","locale");
--> statement-breakpoint
CREATE INDEX "kb_category_translations_locale_idx" ON "kb_category_translations" USING btree ("locale");
