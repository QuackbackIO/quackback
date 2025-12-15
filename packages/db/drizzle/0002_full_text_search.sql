-- Add full-text search capability to posts
-- Uses PostgreSQL generated column with tsvector for automatic indexing

-- Add the search_vector generated column
ALTER TABLE "posts" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED;--> statement-breakpoint

-- Create GIN index for fast full-text search
CREATE INDEX "posts_search_vector_idx" ON "posts" USING gin ("search_vector");
