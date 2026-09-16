import { createFileRoute, redirect } from '@tanstack/react-router'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid'
import { SettingsModuleHub } from '@/components/admin/settings/settings-module-hub'
import { buildSettingsModules } from '@/components/admin/settings/settings-modules'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/support')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  component: SupportSettingsHub,
})

function SupportSettingsHub() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const module = buildSettingsModules(flags).find((item) => item.id === 'support')
  if (!module) return null
  return (
    <SettingsModuleHub
      icon={ChatBubbleLeftRightIcon}
      title={module.label}
      description={module.description}
      pages={module.pages}
    />
  )
}
