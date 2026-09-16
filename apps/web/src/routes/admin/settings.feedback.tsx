import { createFileRoute, redirect } from '@tanstack/react-router'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { SettingsModuleHub } from '@/components/admin/settings/settings-module-hub'
import { buildSettingsModules } from '@/components/admin/settings/settings-modules'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/feedback')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  component: FeedbackSettingsHub,
})

function FeedbackSettingsHub() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const module = buildSettingsModules(flags).find((item) => item.id === 'feedback')
  if (!module) return null
  return (
    <SettingsModuleHub
      icon={ChatBubbleLeftIcon}
      title={module.label}
      description={module.description}
      pages={module.pages}
    />
  )
}
