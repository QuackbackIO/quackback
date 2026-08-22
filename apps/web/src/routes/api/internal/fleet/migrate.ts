import { createFileRoute } from '@tanstack/react-router'
import { handleMigratePost } from '@/lib/server/fleet/migrate-http'

export const Route = createFileRoute('/api/internal/fleet/migrate')({
  server: { handlers: { POST: ({ request }) => handleMigratePost(request) } },
})
