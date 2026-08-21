import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { blankOmittedSearchKeys } from '@/lib/shared/route-search'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  status: z.enum(['draft', 'published']).optional().catch(undefined),
  category: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional().catch(undefined),
  deleted: z.boolean().optional().catch(undefined),
  performance: z.boolean().optional().catch(undefined),
})

export const Route = createFileRoute('/admin/help-center')({
  validateSearch: (raw: Record<string, unknown>) =>
    blankOmittedSearchKeys(raw, searchSchema.parse(raw)),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'helpCenter')) {
      throw redirect({ to: getFirstEnabledAdminProductPath(context.settings?.featureFlags) })
    }
  },
  component: HelpCenterLayout,
})

function HelpCenterLayout() {
  return <Outlet />
}
