import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
  deleted: z.boolean().optional(),
  performance: z.boolean().optional(),
})

export const Route = createFileRoute('/admin/help-center')({
  validateSearch: searchSchema,
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
