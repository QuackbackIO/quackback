ALTER TABLE "notification_preferences" ADD COLUMN "email_ticket_threads" boolean DEFAULT true NOT NULL;
ALTER TABLE "notification_preferences" ADD COLUMN "email_ticket_properties" boolean DEFAULT true NOT NULL;
ALTER TABLE "notification_preferences" ADD COLUMN "email_ticket_status" boolean DEFAULT true NOT NULL;
ALTER TABLE "notification_preferences" ADD COLUMN "email_ticket_assignment" boolean DEFAULT true NOT NULL;
ALTER TABLE "notification_preferences" ADD COLUMN "email_ticket_participants" boolean DEFAULT false NOT NULL;
ALTER TABLE "notification_preferences" ADD COLUMN "email_ticket_shares" boolean DEFAULT false NOT NULL;
ALTER TABLE "notification_preferences" ADD COLUMN "email_ticket_sla" boolean DEFAULT true NOT NULL;

ALTER TABLE "ticket_subscriptions" ADD COLUMN "notify_properties" boolean DEFAULT true NOT NULL;
