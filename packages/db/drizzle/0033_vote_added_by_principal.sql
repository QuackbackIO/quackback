ALTER TABLE "votes" ADD COLUMN "added_by_principal_id" uuid REFERENCES "principal"("id") ON DELETE SET NULL;
