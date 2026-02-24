import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import type { SegmentId } from '@quackback/ids'
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
  sort: z
    .enum(['newest', 'oldest', 'most_active', 'most_posts', 'most_comments', 'most_votes', 'name'])
    .optional()
    .default('newest'),
  selected: z.string().optional(),
  segments: z.string().optional(),
})

type SearchParams = z.infer<typeof searchSchema>

function parseSearchToQueryParams(deps: SearchParams) {
  let verified: boolean | undefined
  if (deps.verified === 'true') verified = true
  else if (deps.verified === 'false') verified = false

  const segmentIds = deps.segments
    ? (deps.segments.split(',').filter(Boolean) as SegmentId[])
    : undefined

  return {
    search: deps.search,
    verified,
    dateFrom: deps.dateFrom ? new Date(deps.dateFrom) : undefined,
    dateTo: deps.dateTo ? new Date(deps.dateTo) : undefined,
    sort: deps.sort,
    page: 1,
    limit: 20,
    segmentIds,
  }
}

export const Route = createFileRoute('/admin/users')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { search, verified, dateFrom, dateTo, sort, segments } }) => ({
    search,
    verified,
    dateFrom,
    dateTo,
    sort,
    segments,
  }),
  errorComponent: UsersErrorComponent,
  loader: async ({ deps, context }) => {
    // Protected route - principal is guaranteed by parent's beforeLoad auth check
    const { principal, queryClient } = context as {
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    await Promise.all([
      queryClient.ensureQueryData(adminQueries.portalUsers(parseSearchToQueryParams(deps))),
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
  const usersQuery = useSuspenseQuery(adminQueries.portalUsers(parseSearchToQueryParams(search)))

  return <UsersContainer initialUsers={usersQuery.data} currentMemberRole={currentMemberRole} />
}
