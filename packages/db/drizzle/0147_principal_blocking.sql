-- Blocking a person (support platform §4.6). principal gains two nullable
-- columns: blocked_at (when the block was set; null = not blocked, the flag the
-- message + re-registration gates read) and blocked_by_principal_id (which team
-- actor blocked them). The FK is self-referential and set-null on delete so
-- removing the acting teammate never silently clears a live block. Additive +
-- backfill-safe: existing rows get NULL (not blocked). Guards in the app layer
-- keep team members and service principals from ever being blocked.

ALTER TABLE "principal" ADD COLUMN "blocked_at" timestamptz;--> statement-breakpoint
ALTER TABLE "principal" ADD COLUMN "blocked_by_principal_id" uuid;--> statement-breakpoint

ALTER TABLE "principal"
	ADD CONSTRAINT "principal_blocked_by_principal_id_principal_id_fk"
	FOREIGN KEY ("blocked_by_principal_id") REFERENCES "principal"("id") ON DELETE SET NULL;
