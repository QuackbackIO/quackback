import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router'
import { z } from 'zod'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

const searchSchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  deleted: z.boolean().optional(),
})

export const Route = createFileRoute('/admin/help-center')({
  validateSearch: searchSchema,
  component: HelpCenterLayout,
})

function HelpCenterLayout() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.helpCenter) {
    return <Navigate to="/admin/feedback" />
  }

  return <Outlet />
}
