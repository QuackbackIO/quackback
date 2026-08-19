-- Board pinning: a post with pinned_at set leads its public board listing
-- under every sort order (post.public.ts orders pinned_at DESC NULLS LAST
-- ahead of the active sort). Null means unpinned; the timestamp orders
-- multiple pinned posts, most recently pinned first.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;
