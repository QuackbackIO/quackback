-- Enable pgvector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

-- Add embedding columns to posts table
ALTER TABLE "posts" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "embedding_updated_at" timestamp with time zone;--> statement-breakpoint

-- Create HNSW index for fast similarity search
-- Only index non-null embeddings for active (non-deleted) posts
CREATE INDEX "posts_embedding_idx" ON "posts" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE "embedding" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint

-- Create post_sentiment table
CREATE TABLE "post_sentiment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"sentiment" text NOT NULL,
	"confidence" real NOT NULL,
	"model" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	CONSTRAINT "post_sentiment_post_id_unique" UNIQUE("post_id"),
	CONSTRAINT "post_sentiment_sentiment_check" CHECK (sentiment IN ('positive', 'neutral', 'negative'))
);--> statement-breakpoint

-- Add foreign key constraint
ALTER TABLE "post_sentiment" ADD CONSTRAINT "post_sentiment_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Create indexes for sentiment queries
CREATE INDEX "post_sentiment_processed_at_idx" ON "post_sentiment" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "post_sentiment_sentiment_idx" ON "post_sentiment" USING btree ("sentiment");
