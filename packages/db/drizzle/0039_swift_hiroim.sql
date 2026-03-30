CREATE TABLE "kb_article_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"principal_id" uuid,
	"helpful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_json" jsonb,
	"principal_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"not_helpful_count" integer DEFAULT 0 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')) STORED,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kb_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_article_feedback_article_id_idx" ON "kb_article_feedback" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_article_feedback_unique_idx" ON "kb_article_feedback" USING btree ("article_id","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_articles_slug_idx" ON "kb_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "kb_articles_category_id_idx" ON "kb_articles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "kb_articles_principal_id_idx" ON "kb_articles" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "kb_articles_published_at_idx" ON "kb_articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "kb_articles_deleted_at_idx" ON "kb_articles" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "kb_articles_category_published_idx" ON "kb_articles" USING btree ("category_id","published_at");--> statement-breakpoint
CREATE INDEX "kb_articles_search_vector_idx" ON "kb_articles" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_categories_slug_idx" ON "kb_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "kb_categories_position_idx" ON "kb_categories" USING btree ("position");--> statement-breakpoint
CREATE INDEX "kb_categories_deleted_at_idx" ON "kb_categories" USING btree ("deleted_at");