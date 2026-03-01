import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ChangelogList, ChangelogModal } from '@/components/admin/changelog'

const searchSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'published']).optional(),
  entry: z.string().optional(), // Entry ID for modal view
  search: z.string().optional(),
})

export const Route = createFileRoute('/admin/changelog')({
  validateSearch: searchSchema,
  component: ChangelogPage,
})

function ChangelogPage() {
  const search = Route.useSearch()

  return (
    <main className="h-full">
      <ChangelogList />
      <ChangelogModal entryId={search.entry} />
    </main>
  )
}
