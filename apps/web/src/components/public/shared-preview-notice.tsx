import { useRouteContext } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'

/**
 * Says the portal is drawn with a shared preview link's design, so nobody
 * takes it for the live site, or that the link has ended and this is the
 * live portal. Nothing without a link.
 */
export function SharedPreviewNotice() {
  const state = useRouteContext({
    from: '__root__',
    select: (context) => context.sharedPreview ?? null,
  })
  if (!state) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <p
        role="status"
        className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-md"
      >
        {state === 'shown' ? (
          <FormattedMessage
            id="portal.sharedPreview.shown"
            defaultMessage="Preview of a design not yet live"
          />
        ) : (
          <FormattedMessage
            id="portal.sharedPreview.ended"
            defaultMessage="This preview link has ended"
          />
        )}
      </p>
    </div>
  )
}
