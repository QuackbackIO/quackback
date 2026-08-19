import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'
import { RoadmapModal } from '@/components/admin/roadmap-modal'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  roadmap: z.string().optional(),
  post: z.string().optional(),
  search: z.string().optional(),
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  sort: z.enum(['votes', 'newest', 'oldest']).optional(),
})

export const Route = createFileRoute('/admin/roadmap')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: getFirstEnabledAdminProductPath(context.settings?.featureFlags) })
    }
  },
  loader: async ({ context }) => {
    const { queryClient } = context

    const { user, principal } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    await Promise.all([
      queryClient.ensureQueryData(adminQueries.statuses()),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.segments()),
    ])

    return {
      currentUser: {
        name: user.name,
        email: user.email,
        principalId: principal.id,
      },
    }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const { currentUser } = Route.useLoaderData()
  const search = Route.useSearch()

  return (
    <main className="h-full">
      <RoadmapAdmin />
      <RoadmapModal postId={search.post} currentUser={currentUser} />
    </main>
  )
}
