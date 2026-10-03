import { FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'

/**
 * The launch plan's first tile after the website lookup: a good logo that was
 * applied, with Undo, or a weak one that is offered with Use it and Not now.
 */
export function AutomaticBrandingNotice({
  status,
  pending,
  error,
  compact = false,
  onUndo,
  onAccept,
  onDismiss,
}: {
  status: AutomaticBrandingStatus | null | undefined
  pending: boolean
  error: string | null
  compact?: boolean
  onUndo: () => void
  onAccept: () => void
  onDismiss: () => void
}) {
  const offered = status?.status === 'offered' && status.canUse
  if (!status || (!offered && status.status !== 'applied')) return null
  const action = compact ? 'h-auto px-0 py-0 text-xs underline underline-offset-4' : undefined
  const thumbnail = status.logoUrl ? (
    <img
      src={status.logoUrl}
      alt=""
      className="size-7 shrink-0 rounded-md border bg-background object-contain"
    />
  ) : null
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {offered ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {thumbnail}
            <span>
              <FormattedMessage
                id="onboarding.branding.offer"
                defaultMessage="Use the logo from {domain}?"
                values={{ domain: status.domain }}
              />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={compact ? 'ghost' : 'default'}
              className={action}
              disabled={pending}
              onClick={onAccept}
            >
              <FormattedMessage id="onboarding.branding.use" defaultMessage="Use it" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={action}
              disabled={pending}
              onClick={onDismiss}
            >
              <FormattedMessage id="onboarding.branding.notNow" defaultMessage="Not now" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {thumbnail}
          <span className="flex-1">
            {status.colorApplied ? (
              <FormattedMessage
                id="onboarding.branding.logoAndColorFromWebsite"
                defaultMessage="Logo and color from {domain}"
                values={{ domain: status.domain }}
              />
            ) : (
              <FormattedMessage
                id="onboarding.branding.fromWebsite"
                defaultMessage="Logo from {domain}"
                values={{ domain: status.domain }}
              />
            )}
          </span>
          {status.canUndo && (
            <Button
              size="sm"
              variant={compact ? 'ghost' : 'outline'}
              className={cn(action, !compact && 'h-7')}
              disabled={pending}
              onClick={onUndo}
            >
              <FormattedMessage id="onboarding.branding.undo" defaultMessage="Undo" />
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
