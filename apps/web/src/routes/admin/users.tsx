import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/queries/admin'
import { UsersContainer } from '@/components/admin/users/users-container'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

const searchSchema = z.object({
  search: z.string().optional(),
  verified: z.enum(['true', 'false']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'most_active', 'name']).optional().default('newest'),
})

export const Route = createFileRoute('/admin/users')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    search: search.search,
    verified: search.verified,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    sort: search.sort,
  }),
  errorComponent: UsersErrorComponent,
  loader: async ({ deps, context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { member, queryClient } = context

    // Parse verified param
    const verified = deps.verified === 'true' ? true : deps.verified === 'false' ? false : undefined

    // Pre-fetch users data using React Query
    await queryClient.ensureQueryData(
      adminQueries.portalUsers({
        search: deps.search,
        verified,
        dateFrom: deps.dateFrom ? new Date(deps.dateFrom) : undefined,
        dateTo: deps.dateTo ? new Date(deps.dateTo) : undefined,
        sort: deps.sort,
        page: 1,
        limit: 20,
      })
    )

    return {
      currentMemberRole: member.role,
    }
  },
  component: UsersPage,
})

function UsersErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
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
    })
  )

  // Handle error state from service Result type
  const initialUsers = usersQuery.data.success
    ? usersQuery.data.value
    : { items: [], total: 0, hasMore: false }

  return <UsersContainer initialUsers={initialUsers} currentMemberRole={currentMemberRole} />
}
