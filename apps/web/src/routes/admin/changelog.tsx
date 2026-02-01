import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ChangelogList } from '@/components/admin/changelog'

const searchSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'published']).optional(),
})

export const Route = createFileRoute('/admin/changelog')({
  validateSearch: searchSchema,
  component: ChangelogPage,
})

function ChangelogPage() {
  return (
    <main className="h-full bg-card">
      <ChangelogList />
    </main>
  )
}
