import type { ReactNode } from 'react'

/**
 * A titled part of a settings page that holds more than one thing (Office
 * hours and SLA policies on Hours & SLAs). The title sits above the part's
 * cards with its action to the right; a page with a single part has no use
 * for it.
 */
export function SettingsSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
