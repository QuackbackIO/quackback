-- Indexes for feedback pipeline queryability
CREATE INDEX "feedback_suggestions_result_post_idx" ON "feedback_suggestions" USING btree ("result_post_id");
CREATE INDEX "feedback_suggestions_signal_idx" ON "feedback_suggestions" USING btree ("signal_id");
CREATE INDEX "raw_feedback_principal_idx" ON "raw_feedback_items" USING btree ("principal_id");

-- Direct provenance link from proxy votes to their source feedback suggestion
ALTER TABLE "votes" ADD COLUMN "feedback_suggestion_id" uuid;
ALTER TABLE "votes" ADD CONSTRAINT "votes_feedback_suggestion_id_feedback_suggestions_id_fk" FOREIGN KEY ("feedback_suggestion_id") REFERENCES "feedback_suggestions"("id") ON DELETE set null ON UPDATE no action;
