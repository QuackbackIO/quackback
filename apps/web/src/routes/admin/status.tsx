import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StatusAdmin } from '@/components/admin/status'

const searchSchema = z.object({
  view: z.enum(['open', 'maintenance', 'all', 'components', 'templates', 'subscribers']).optional(),
  incident: z.string().optional(), // Incident ID for the composer modal view
})

export const Route = createFileRoute('/admin/status')({
  validateSearch: searchSchema,
  component: StatusPage,
})

function StatusPage() {
  return (
    <main className="h-full">
      <StatusAdmin />
    </main>
  )
}
