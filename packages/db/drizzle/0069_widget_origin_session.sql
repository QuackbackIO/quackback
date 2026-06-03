-- Tracks sessions created via the widget OTT handoff route.
-- Used by the portal access evaluator to restrict the widget grant
-- to sessions that actually came through the widget sign-in flow
-- (as opposed to any role='user' with a portal session).
--
-- PK on session_id is the lookup key (one row per session).
-- Index on user_id supports cleanup queries.
CREATE TABLE "widget_origin_session" (
  "session_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "marked_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "widget_origin_session_user_id_idx" ON "widget_origin_session" ("user_id");
