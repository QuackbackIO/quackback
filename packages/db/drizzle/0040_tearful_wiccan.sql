CREATE TABLE "analytics_daily_stats" (
	"date" date PRIMARY KEY NOT NULL,
	"new_posts" integer DEFAULT 0 NOT NULL,
	"new_votes" integer DEFAULT 0 NOT NULL,
	"new_comments" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"posts_by_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posts_by_board" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posts_by_source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_top_posts" (
	"period" text NOT NULL,
	"rank" integer NOT NULL,
	"post_id" uuid NOT NULL,
	"title" text NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"board_name" text,
	"status_name" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_top_posts_period_rank_pk" PRIMARY KEY("period","rank")
);
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;