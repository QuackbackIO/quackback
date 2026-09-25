import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { blankOmittedSearchKeys } from '@/lib/shared/route-search'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'
import { helpCenterSearchSchema } from '@/components/admin/help-center/help-center-search'

export const Route = createFileRoute('/admin/help-center')({
  validateSearch: (raw: Record<string, unknown>) =>
    blankOmittedSearchKeys(raw, helpCenterSearchSchema.parse(raw)),
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
