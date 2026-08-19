import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  owner: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.string().optional(),
  minComments: z.string().optional(),
  responded: z.enum(['all', 'responded', 'unresponded']).optional(),
  updatedBefore: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'votes', 'priority']).optional().default('newest'),
  hasDuplicates: z.boolean().optional(),
  deleted: z.boolean().optional(),
  post: z.string().optional(),
  // Roadmap-specific
  roadmap: z.string().optional(),
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: searchSchema,
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
