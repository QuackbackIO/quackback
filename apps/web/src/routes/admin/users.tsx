import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireAuthenticatedWorkspace } from '@/lib/workspace'
import { listPortalUsers } from '@/lib/users'
import { UsersContainer } from '@/app/admin/users/users-container'
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
  loader: async ({ deps }) => {
    // Settings is validated in root layout
    const { member } = await requireAuthenticatedWorkspace()

    // Parse verified param
    const verified = deps.verified === 'true' ? true : deps.verified === 'false' ? false : undefined

    // Fetch initial users with filters from URL
    const usersResult = await listPortalUsers({
      search: deps.search,
      verified,
      dateFrom: deps.dateFrom ? new Date(deps.dateFrom) : undefined,
      dateTo: deps.dateTo ? new Date(deps.dateTo) : undefined,
      sort: deps.sort,
      page: 1,
      limit: 20,
    })

    const initialUsers = usersResult.success
      ? usersResult.value
      : { items: [], total: 0, hasMore: false }

    return {
      initialUsers,
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
  const { initialUsers, currentMemberRole } = Route.useLoaderData()

  return <UsersContainer initialUsers={initialUsers} currentMemberRole={currentMemberRole} />
}
