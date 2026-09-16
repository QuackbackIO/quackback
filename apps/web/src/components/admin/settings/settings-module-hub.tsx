import type { ComponentType } from 'react'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsMenuCard, SettingsMenuRow } from '@/components/admin/settings/settings-menu-card'
import type { SettingsModulePage } from '@/components/admin/settings/settings-modules'

export function SettingsModuleHub({
  icon,
  title,
  description,
  pages,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  pages: SettingsModulePage[]
}) {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader icon={icon} title={title} description={description} />
      <SettingsMenuCard>
        {pages.map((page) => (
          <SettingsMenuRow
            key={page.to}
            to={page.to}
            icon={page.icon}
            title={page.label}
            description={page.description}
          />
        ))}
      </SettingsMenuCard>
    </div>
  )
}
