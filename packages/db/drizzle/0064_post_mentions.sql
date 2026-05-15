-- Join table recording every @-mention of a principal inside a post body.
--
-- Drives the post.mentioned notification pipeline and the in-app
-- "mentioned me" feed. The application inserts one row per
-- (post, principal) pair the first time a mention appears; the unique
-- index keeps re-edits of the same post idempotent. `notified_at` is
-- stamped when the notification has been delivered so subsequent edits
-- don't fire duplicate emails / in-app notifications for the same
-- target.
--
-- Both foreign keys cascade on delete: when a post is hard-deleted or a
-- principal is removed we don't keep dangling mention rows around.
--
-- The (principal_id, created_at DESC) index serves the "mentions of me,
-- newest first" feed straight from the index without a sort pass.

CREATE TABLE "post_mentions" (
  "id" uuid PRIMARY KEY,
  "post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
  "principal_id" uuid NOT NULL REFERENCES "principal"("id") ON DELETE CASCADE,
  "notified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "post_mentions_post_principal_uq"
  ON "post_mentions" ("post_id", "principal_id");

CREATE INDEX "post_mentions_principal_idx"
  ON "post_mentions" ("principal_id", "created_at" DESC);
