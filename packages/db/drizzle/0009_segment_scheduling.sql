-- Add evaluation_schedule and weight_config columns to segments table
-- evaluation_schedule: JSONB for auto-evaluation cron configuration
-- weight_config: JSONB for segment weighting (e.g. weight by MRR/revenue)
ALTER TABLE "segments" ADD COLUMN "evaluation_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "weight_config" jsonb;
