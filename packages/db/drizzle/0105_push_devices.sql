-- Push notification device registry: one row per APNs/FCM registration token,
-- owned by an agent's principal. The mobile agent app registers here via
-- POST /api/devices; a push consumer reads it to fan notifications out to the
-- right devices. Generic by design — a self-hoster who never ships an app
-- simply never writes here. Scoped to the tenant by the database connection
-- (database-per-tenant); no workspace column.
CREATE TABLE "push_devices" (
  "id" uuid PRIMARY KEY NOT NULL,
  "principal_id" uuid NOT NULL REFERENCES "principal"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "platform" text NOT NULL,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- One principal per token: re-registering a token re-binds it (upsert on token).
CREATE UNIQUE INDEX "push_devices_token_idx" ON "push_devices" ("token");

-- Fan-out lookup: all of an agent's devices.
CREATE INDEX "push_devices_principal_idx" ON "push_devices" ("principal_id");
