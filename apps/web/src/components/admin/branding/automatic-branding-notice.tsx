import { FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'

export function AutomaticBrandingNotice({
  status,
  pending,
  error,
  onUndo,
}: {
  status: AutomaticBrandingStatus | null | undefined
  pending: boolean
  error: string | null
  onUndo: () => void
}) {
  if (status?.status !== 'applied') return null
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1">
        <span>
          <FormattedMessage
            id="onboarding.branding.fromWebsite"
            defaultMessage="Logo from {domain}"
            values={{ domain: status.domain }}
          />
        </span>
        {status.canUndo && (
          <>
            <span aria-hidden="true">·</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground"
              disabled={pending}
              onClick={onUndo}
            >
              <FormattedMessage id="ask.settings.undo" defaultMessage="Undo" />
            </Button>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
