-- Add audit columns to votes table for improved tracking and abuse prevention

-- Add member_id column for FK integrity (nullable for anonymous votes)
ALTER TABLE "votes" ADD COLUMN "member_id" text;--> statement-breakpoint

-- Add ip_hash column for abuse detection (hashed IP, privacy-preserving)
ALTER TABLE "votes" ADD COLUMN "ip_hash" text;--> statement-breakpoint

-- Add updated_at column to track vote toggle history
ALTER TABLE "votes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Add foreign key constraint for member_id
ALTER TABLE "votes" ADD CONSTRAINT "votes_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Add index for member_id lookups
CREATE INDEX "votes_member_id_idx" ON "votes" USING btree ("member_id");
