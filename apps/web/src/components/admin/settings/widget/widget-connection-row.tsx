import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { StateBadge } from '@/components/shared/state-badge'
import { WidgetLastDetected } from '@/components/admin/settings/widget/widget-last-detected'
import { widgetInstallPresence } from '@/lib/shared/widget/widget-origin'
import { widgetSdkUpdateDescription } from '@/lib/shared/widget/sdk-version'

export interface WidgetConnectionStatus {
  hasWidgetInstalled?: boolean
  widgetOriginHost?: string | null
  widgetLastDetectedAt?: string | null
  widgetSdkVersion?: string | null
  currentWidgetSdkVersion?: string
  widgetSdkNeedsUpdate?: boolean
}

/**
 * The widget's install state as one setting row: a Connected badge once it
 * loads on a page and is visible, Needs attention when it is hidden or
 * outdated, and no badge before it has been seen.
 */
export function WidgetConnectionRow({
  label,
  status,
  enabled,
  waiting,
}: {
  label: string
  status: WidgetConnectionStatus
  /** The "Show on your website" switch. */
  enabled: boolean
  /** Before the first request, say the page is waiting for it instead. */
  waiting?: boolean
}) {
  const installed = Boolean(status.hasWidgetInstalled)
  const presence = widgetInstallPresence({
    connected: installed,
    enabled,
    originHost: status.widgetOriginHost,
  })
  const needsUpdate = installed && Boolean(status.widgetSdkNeedsUpdate)

  const description = needsUpdate
    ? widgetSdkUpdateDescription(status.widgetSdkVersion, status.currentWidgetSdkVersion)
    : presence.tone === 'idle'
      ? 'Not on your site yet'
      : presence.description

  let control: React.ReactNode = null
  if (needsUpdate || presence.tone === 'detected') control = <StateBadge state="attention" />
  else if (presence.tone === 'live') control = <StateBadge state="connected" />
  else if (waiting)
    control = <ArrowPathIcon className="size-4 animate-spin text-muted-foreground" />

  return (
    <SettingRow
      label={label}
      description={
        waiting && presence.tone === 'idle' ? (
          'Waiting for the widget to load…'
        ) : (
          <>
            {description}
            {installed && status.widgetLastDetectedAt && (
              <>
                {' '}
                <WidgetLastDetected at={status.widgetLastDetectedAt} inline />
              </>
            )}
          </>
        )
      }
      control={control}
    />
  )
}
