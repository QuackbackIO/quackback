import { createFileRoute } from '@tanstack/react-router'
import { handleMigrateBundle } from '@/lib/server/fleet/migrate-http'

export const Route = createFileRoute('/api/internal/fleet/migrate/bundle')({
  server: { handlers: { GET: ({ request }) => handleMigrateBundle(request) } },
})
