import { createFileRoute } from '@tanstack/react-router'
import { ExperimentalSettings } from '@/components/admin/settings/experimental-settings'

export const Route = createFileRoute('/admin/settings/experimental')({
  component: ExperimentalSettings,
})
