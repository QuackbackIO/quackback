-- Provenance row per session minted by /api/widget/identify.
-- hmac_verified records whether the identify claim was HMAC-verified
-- at session-creation time. The widget-handoff route requires
-- hmac_verified = true before inserting widget_origin_session, so
-- only sessions whose identity was vouched for by the embedding site
-- can earn the widget portal-access grant.
--
-- Upsert semantics: re-identify can flip hmac_verified to reflect
-- the latest path. A session that loses HMAC verification on a
-- re-identify must lose the trust it carries.
--
-- PK on session_id is the lookup key.
CREATE TABLE "widget_identified_session" (
  "session_id" text PRIMARY KEY NOT NULL,
  "hmac_verified" boolean NOT NULL,
  "identified_at" timestamp with time zone DEFAULT now() NOT NULL
);
