import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { UsersContainer } from '@/components/admin/users/users-container'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

const searchSchema = z.object({
  search: z.string().optional(),
  verified: z.enum(['true', 'false']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'most_active', 'name']).optional().default('newest'),
  selected: z.string().optional(),
  /** Comma-separated segment IDs for filtering */
  segments: z.string().optional(),
})

export const Route = createFileRoute('/admin/users')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    search: search.search,
    verified: search.verified,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    sort: search.sort,
    segments: search.segments,
  }),
  errorComponent: UsersErrorComponent,
  loader: async ({ deps, context }) => {
    // Protected route - principal is guaranteed by parent's beforeLoad auth check
    const { principal, queryClient } = context as {
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    // Parse verified param
    const verified = deps.verified === 'true' ? true : deps.verified === 'false' ? false : undefined
    const segmentIds = deps.segments ? deps.segments.split(',').filter(Boolean) : undefined

    // Pre-fetch users and segments data using React Query
    await Promise.all([
      queryClient.ensureQueryData(
        adminQueries.portalUsers({
          search: deps.search,
          verified,
          dateFrom: deps.dateFrom ? new Date(deps.dateFrom) : undefined,
          dateTo: deps.dateTo ? new Date(deps.dateTo) : undefined,
          sort: deps.sort,
          page: 1,
          limit: 20,
          segmentIds,
        })
      ),
      queryClient.ensureQueryData(adminQueries.segments()),
    ])

    return {
      currentMemberRole: principal.role,
    }
  },
  component: UsersPage,
})

function UsersErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <ExclamationCircleIcon className="h-4 w-4" />
        <AlertTitle>Failed to load users</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-4">{error.message}</p>
          <Button onClick={reset} variant="outline" size="sm">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

function UsersPage() {
  const { currentMemberRole } = Route.useLoaderData()
  const search = Route.useSearch()

  // Parse verified param (same logic as in loader)
  const verified =
    search.verified === 'true' ? true : search.verified === 'false' ? false : undefined

  const segmentIds = search.segments ? search.segments.split(',').filter(Boolean) : undefined

  // Read pre-fetched data from React Query cache
  const usersQuery = useSuspenseQuery(
    adminQueries.portalUsers({
      search: search.search,
      verified,
      dateFrom: search.dateFrom ? new Date(search.dateFrom) : undefined,
      dateTo: search.dateTo ? new Date(search.dateTo) : undefined,
      sort: search.sort,
      page: 1,
      limit: 20,
      segmentIds,
    })
  )

  // Server function already returns the unwrapped result (not Result type)
  const initialUsers = usersQuery.data

  return <UsersContainer initialUsers={initialUsers} currentMemberRole={currentMemberRole} />
}
