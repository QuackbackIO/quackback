import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  portalUsersInfiniteOptions,
  defaultUsersFilters,
} from '@/lib/client/hooks/use-users-queries'
import { UsersContainer } from '@/components/admin/users/users-container'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

const searchSchema = z.object({
  search: z.string().optional(),
  verified: z.enum(['true', 'false']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  emailDomain: z.string().optional(),
  postCount: z.string().optional(),
  voteCount: z.string().optional(),
  commentCount: z.string().optional(),
  customAttrs: z.string().optional(),
  // Companies-tab filters, "key:op:value" parts (reserved keys: plan, mrr).
  companyAttrs: z.string().optional(),
  // Lifecycle view: absent = identified users, 'leads' = engaged anonymous
  // principals (the "All leads" nav entry), 'companies' = the companies
  // directory tab.
  lifecycle: z.enum(['leads', 'companies']).optional(),
  // Selected company id — flips the companies view to the company profile.
  company: z.string().optional(),
  sort: z
    .enum([
      'newest',
      'oldest',
      'most_active',
      'last_active',
      'most_posts',
      'most_comments',
      'most_votes',
      'name',
    ])
    .optional()
    .default('newest'),
  selected: z.string().optional(),
  segments: z.string().optional(),
  // When set, /admin/users renders the Invitations view instead of the
  // signed-up users list. 'pending' is the deep-link target from the
  // Portal settings page; the view itself lets admins flip between
  // statuses without leaving the page.
  invites: z.enum(['pending', 'accepted', 'expired', 'all']).optional(),
})

export const Route = createFileRoute('/admin/users')({
  validateSearch: searchSchema,
  // Note: No loaderDeps for the filter fields - the loader only runs on
  // initial route load for SSR (prefetching the default/unfiltered dataset).
  // Client-side filter changes are handled by UsersContainer's usePortalUsers
  // (combined with its placeholderData) instead of re-running this loader —
  // mirrors the documented pattern in src/routes/_portal/index.tsx.
  errorComponent: UsersErrorComponent,
  loader: async ({ context }) => {
    // Protected route - principal is guaranteed by parent's beforeLoad auth check
    const { principal, queryClient } = context as {
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    await Promise.all([
      // Warm the SAME infinite cache the Users list renders (QC-1), so a
      // segment membership change (invalidating usersKeys.all) reaches it.
      queryClient.ensureInfiniteQueryData(portalUsersInfiniteOptions(defaultUsersFilters)),
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

  // The Users list is read by UsersContainer's own infinite `usePortalUsers`
  // hook, which shares its query definition with the loader's prefetch (QC-1) —
  // no separate suspense query here.
  return <UsersContainer currentMemberRole={currentMemberRole} />
}
