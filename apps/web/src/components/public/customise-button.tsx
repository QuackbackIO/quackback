import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext, useRouterState } from '@tanstack/react-router'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { FormattedMessage, useIntl } from 'react-intl'
import { PencilSquareIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'

/** Where the button goes when the portal is still on its old theme for its CSS. */
const SWITCH_CARD_HREF = '/admin/settings/portal#design-switch'

/**
 * Opens the portal designer on the page someone is on, for people who may
 * change the branding while the designer's Labs switch is on. A portal kept on
 * its old theme by its own CSS goes to the switch card in Settings › Portal
 * instead. Never inside a preview, which is the designer's own canvas. A
 * component of its own, so a navigation renders it again and not the whole
 * header.
 */
export function CustomiseButton() {
  const intl = useIntl()
  const { can } = usePortalPermissions()
  const target = useRouteContext({
    from: '__root__',
    select: (context): 'designer' | 'switch' | null => {
      if (context.settings?.portalDesign?.engine === 'v2') return 'designer'
      return context.settings?.portalDesignSwitchable ? 'switch' : null
    },
  })
  const here = useRouterState({ select: (s) => s.location.pathname })
  const inPreview = useRouterState({
    select: (s) => (s.location.search as { preview?: unknown } | undefined)?.preview === true,
  })
  const shown = target !== null && !inPreview && can(PERMISSIONS.SETTINGS_BRANDING)
  // A dot says a draft is waiting; the label says the designer is on its way once clicked.
  const waiting = useQuery({
    ...portalDesignQueries.draftWaiting(),
    enabled: shown && target === 'designer',
  }).data?.waiting
  const [opening, setOpening] = useState(false)
  if (!shown) return null
  const toSwitch = target === 'switch'
  return (
    <Button variant="outline" size="sm" asChild className="relative ms-1">
      <a
        href={toSwitch ? SWITCH_CARD_HREF : `/design?path=${encodeURIComponent(here)}&from=portal`}
        title={
          toSwitch
            ? intl.formatMessage({
                id: 'portal.header.customiseSwitchFirst',
                defaultMessage: 'Switch to the new design to customise',
              })
            : undefined
        }
        aria-busy={opening || undefined}
        onClick={() => setOpening(true)}
      >
        <PencilSquareIcon className="me-2 h-4 w-4" aria-hidden="true" />
        {opening ? (
          <FormattedMessage id="portal.header.customiseOpening" defaultMessage="Opening…" />
        ) : (
          <FormattedMessage id="portal.header.customise" defaultMessage="Customise" />
        )}
        {waiting && (
          <>
            <span
              aria-hidden="true"
              className="absolute -end-1 -top-1 size-2.5 rounded-full bg-foreground ring-2 ring-background"
            />
            <span className="sr-only">
              <FormattedMessage
                id="portal.header.customiseDraftWaiting"
                defaultMessage="A draft is waiting"
              />
            </span>
          </>
        )}
      </a>
    </Button>
  )
}
