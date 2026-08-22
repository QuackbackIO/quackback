import { createFileRoute } from '@tanstack/react-router'
import { handleMigratePlan } from '@/lib/server/fleet/migrate-http'

export const Route = createFileRoute('/api/internal/fleet/migrate/plan')({
  server: { handlers: { POST: ({ request }) => handleMigratePlan(request) } },
})
