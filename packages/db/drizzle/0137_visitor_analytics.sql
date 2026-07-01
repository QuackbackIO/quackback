-- Visitor analytics: raw pageview events (day-partitioned) + rollup tables.
-- page_views is declaratively range-partitioned by day on occurred_at. The
-- initial partition window is created here; the daily maintenance job extends
-- it and drops partitions past the retention window. Rows carry only derived
-- fields: raw IP and User-Agent are never stored (visitor_hash is a
-- daily-salted hash, unlinkable across days once the salt rotates).
CREATE TABLE "page_views" (
	"id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site_origin" text NOT NULL,
	"surface" text NOT NULL,
	"path" text NOT NULL,
	"source" text,
	"country" text,
	"device" text,
	"browser" text,
	"os" text,
	"visitor_hash" text NOT NULL,
	"device_id" text,
	"principal_id" uuid,
	CONSTRAINT "page_views_pkey" PRIMARY KEY ("occurred_at", "id")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
CREATE INDEX "page_views_path_occurred_idx" ON "page_views" ("path", "occurred_at");
--> statement-breakpoint
CREATE INDEX "page_views_device_id_idx" ON "page_views" ("device_id") WHERE "device_id" IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
	d date;
BEGIN
	-- Initial window: yesterday through a week out. Bounds are day-granular so
	-- retention can drop whole partitions instantly.
	FOR i IN -1..7 LOOP
		d := current_date + i;
		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS %I PARTITION OF "page_views" FOR VALUES FROM (%L) TO (%L)',
			'page_views_' || to_char(d, 'YYYYMMDD'),
			d,
			d + 1
		);
	END LOOP;
END $$;
--> statement-breakpoint
CREATE TABLE "visitor_stats_daily" (
	"date" date NOT NULL,
	"surface" text NOT NULL,
	"unique_visitors" integer DEFAULT 0 NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitor_stats_daily_pkey" PRIMARY KEY ("date", "surface")
);
--> statement-breakpoint
CREATE TABLE "visitor_top_stats" (
	"period" text NOT NULL,
	"surface" text NOT NULL,
	"dimension" text NOT NULL,
	"rank" integer NOT NULL,
	"label" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitor_top_stats_pkey" PRIMARY KEY ("period", "surface", "dimension", "rank")
);
