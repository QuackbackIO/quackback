-- GitHub inbox channel: dedupe inbound issue comments on the REST comment id
-- (GitHub redelivers webhooks), and at most one live github connection account
-- per workspace (inbox enabled = this row exists and is not soft-deleted).
CREATE UNIQUE INDEX "conversation_messages_github_comment_id_idx"
	ON "conversation_messages" USING btree ((metadata ->> 'githubCommentId'))
	WHERE (metadata ->> 'githubCommentId') IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_one_github_connection_uq"
	ON "channel_accounts" ("owning_team_id")
	WHERE "role" = 'connection' AND "channel" = 'github' AND "deleted_at" IS NULL;
