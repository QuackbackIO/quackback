ALTER TABLE "comments" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_org_id_idx" ON "comments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "posts_org_id_idx" ON "posts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "posts_org_board_vote_created_idx" ON "posts" USING btree ("organization_id","board_id","vote_count");--> statement-breakpoint
CREATE INDEX "posts_with_status_idx" ON "posts" USING btree ("status_id","vote_count") WHERE status_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "votes_org_id_idx" ON "votes" USING btree ("organization_id");--> statement-breakpoint
ALTER POLICY "comment_reactions_tenant_isolation" ON "comment_reactions" TO app_user USING (comment_id IN (
  SELECT id FROM comments WHERE organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (comment_id IN (
  SELECT id FROM comments WHERE organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
ALTER POLICY "comments_tenant_isolation" ON "comments" TO app_user USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
ALTER POLICY "post_roadmaps_tenant_isolation" ON "post_roadmaps" TO app_user USING (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
ALTER POLICY "post_tags_tenant_isolation" ON "post_tags" TO app_user USING (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
ALTER POLICY "posts_tenant_isolation" ON "posts" TO app_user USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
ALTER POLICY "votes_tenant_isolation" ON "votes" TO app_user USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));