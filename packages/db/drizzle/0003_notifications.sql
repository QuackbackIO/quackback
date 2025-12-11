-- Migration: User Notification Subscriptions
-- Adds tables for post subscriptions, notification preferences, and unsubscribe tokens

-- Post subscriptions - tracks which users are subscribed to which posts
CREATE TABLE "post_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
  "member_id" text NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "reason" varchar(20) NOT NULL,
  "muted" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Unique constraint: one subscription per member per post
CREATE UNIQUE INDEX "post_subscriptions_unique" ON "post_subscriptions" ("post_id", "member_id");
CREATE INDEX "post_subscriptions_member_idx" ON "post_subscriptions" ("member_id");
CREATE INDEX "post_subscriptions_post_idx" ON "post_subscriptions" ("post_id");

-- RLS for post_subscriptions (via post -> board -> organization)
ALTER TABLE "post_subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_subscriptions_tenant_isolation" ON "post_subscriptions"
  FOR ALL TO "app_user"
  USING (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = current_setting('app.organization_id', true)
  ))
  WITH CHECK (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = current_setting('app.organization_id', true)
  ));

-- Notification preferences - per-member email notification settings
CREATE TABLE "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "member_id" text NOT NULL UNIQUE REFERENCES "member"("id") ON DELETE CASCADE,
  "email_status_change" boolean DEFAULT true NOT NULL,
  "email_new_comment" boolean DEFAULT true NOT NULL,
  "email_muted" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "notification_preferences_member_idx" ON "notification_preferences" ("member_id");

-- RLS for notification_preferences (via member -> organization)
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_preferences_tenant_isolation" ON "notification_preferences"
  FOR ALL TO "app_user"
  USING (member_id IN (
    SELECT id FROM member
    WHERE organization_id = current_setting('app.organization_id', true)
  ))
  WITH CHECK (member_id IN (
    SELECT id FROM member
    WHERE organization_id = current_setting('app.organization_id', true)
  ));

-- Unsubscribe tokens - one-time tokens for email unsubscribe links
CREATE TABLE "unsubscribe_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" text NOT NULL UNIQUE,
  "member_id" text NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "post_id" uuid REFERENCES "posts"("id") ON DELETE CASCADE,
  "action" varchar(30) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "unsubscribe_tokens_token_idx" ON "unsubscribe_tokens" ("token");
CREATE INDEX "unsubscribe_tokens_member_idx" ON "unsubscribe_tokens" ("member_id");

-- Grant permissions to app_user
GRANT SELECT, INSERT, UPDATE, DELETE ON "post_subscriptions" TO "app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preferences" TO "app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON "unsubscribe_tokens" TO "app_user";
