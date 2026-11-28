import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { StatusAdmin } from '@/components/admin/status'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'
import { seedAdminAreas } from '@/lib/shared/i18n'

const searchSchema = z.object({
  view: z
    .enum(['overview', 'open', 'maintenance', 'all', 'components', 'templates', 'subscribers'])
    .optional(),
  incident: z.string().optional(), // Incident ID for the composer modal view
})

export const Route = createFileRoute('/admin/status')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'status')) {
      throw redirect({ to: getFirstEnabledAdminProductPath(context.settings?.featureFlags) })
    }
  },
  loader: ({ context }) => seedAdminAreas(context.personLocale, 'adminHelpCenter'),
  component: StatusPage,
})

function StatusPage() {
  return (
    <div className="h-full">
      <StatusAdmin />
    </div>
  )
}
