import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { blankOmittedSearchKeys } from '@/lib/shared/route-search'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  board: z.array(z.string()).optional().catch(undefined),
  tags: z.array(z.string()).optional().catch(undefined),
  status: z.array(z.string()).optional().catch(undefined),
  segments: z.array(z.string()).optional().catch(undefined),
  owner: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.string().optional().catch(undefined),
  minComments: z.string().optional(),
  responded: z.enum(['all', 'responded', 'unresponded']).optional().catch(undefined),
  updatedBefore: z.string().optional(),
  // Portal leftover `sort=trending` must not fail this route.
  sort: z.enum(['newest', 'oldest', 'votes', 'priority']).optional().catch(undefined),
  hasDuplicates: z.boolean().optional().catch(undefined),
  deleted: z.boolean().optional().catch(undefined),
  post: z.string().optional(),
  // Roadmap-specific
  roadmap: z.string().optional(),
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: (raw: Record<string, unknown>) =>
    blankOmittedSearchKeys(raw, searchSchema.parse(raw)),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: getFirstEnabledAdminProductPath(context.settings?.featureFlags) })
    }
  },
  component: FeedbackLayout,
})

function FeedbackLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
