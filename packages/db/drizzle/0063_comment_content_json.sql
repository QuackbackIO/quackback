-- Add content_json + previous_content_json columns to comments + comment_edit_history.
--
-- Mirrors the posts pattern (posts.content_json, post_edit_history.previous_content_json):
-- markdown stays the source of truth on the API, but the server parses + sanitises
-- a TipTap doc at write time so the read path can short-circuit instead of parsing
-- markdown on every render. The new comment composer (rich editor) sends contentJson
-- directly; API clients that POST `content` still work via the existing
-- commentMarkdownToTiptapJson dual-write.
--
-- Nullable on both tables: legacy rows keep working through the markdown fallback in
-- comment-content.tsx, and the optimistic-update cache that writes a fake comment
-- without contentJson is tolerated.

ALTER TABLE comments
  ADD COLUMN content_json jsonb;

ALTER TABLE comment_edit_history
  ADD COLUMN previous_content_json jsonb;
