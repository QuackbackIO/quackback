-- The Quinn performance dashboard scans assistant_involvements by created_at
-- alone (only conversation_id and a partial active-status index exist today)
-- and assistant_tool_calls by status = 'succeeded' + created_at (the existing
-- (conversation_id, created_at) index doesn't serve that query).
CREATE INDEX "assistant_involvements_created_at_idx" ON "assistant_involvements" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_status_created_at_idx" ON "assistant_tool_calls" USING btree ("status","created_at");
