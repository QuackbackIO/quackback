ALTER TABLE "status_incident_updates" ADD COLUMN "template_id" uuid;
--> statement-breakpoint
ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_template_id_status_incident_templates_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "public"."status_incident_templates"("id") ON DELETE set null ON UPDATE no action;
