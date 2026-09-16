import type { ComponentType, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'

/** Card of rows used by Channels and other settings hubs. */
export function SettingsMenuCard({ children }: { children: ReactNode }) {
  return (
    <SettingsCard contentClassName="p-0 sm:p-0">
      <div data-settings-list="" className="divide-y divide-border">
        {children}
      </div>
    </SettingsCard>
  )
}

export function SettingsMenuRow({
  to,
  search,
  params,
  icon: Icon,
  title,
  description,
  trailing,
}: {
  to: string
  search?: Record<string, string | string[] | undefined>
  params?: Record<string, string>
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  trailing?: ReactNode
}) {
  return (
    <Link
      to={to}
      search={search}
      params={params}
      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          {description ? (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {trailing}
    </Link>
  )
}
