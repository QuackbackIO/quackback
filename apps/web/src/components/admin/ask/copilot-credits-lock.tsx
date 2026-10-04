import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { billingQueries } from '@/lib/client/queries/billing'
import { useBillingEnabled } from '@/lib/client/hooks/use-root-context'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  copilotCreditsOffer,
  type AiCreditsState,
  type CopilotCreditsOffer,
} from '@/lib/shared/billing/ai-credits'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'

function OfferLine({ offer }: { offer: CopilotCreditsOffer }) {
  const intl = useIntl()
  const price = intl.formatNumber(offer.priceCents / 100, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: offer.priceCents % 100 === 0 ? 0 : 2,
  })
  if (offer.kind === 'topUp') {
    return (
      <FormattedMessage
        id="ask.locked.topUp"
        defaultMessage="More credits start at {price}."
        values={{ price }}
      />
    )
  }
  return offer.perSeat ? (
    <FormattedMessage
      id="ask.locked.planSeat"
      defaultMessage="{plan} includes them, from {price} per seat a month."
      values={{ plan: offer.planName, price }}
    />
  ) : (
    <FormattedMessage
      id="ask.locked.plan"
      defaultMessage="{plan} includes them, from {price} a month."
      values={{ plan: offer.planName, price }}
    />
  )
}

/**
 * Over the greyed-out composer when Copilot has no AI credits: what is wrong,
 * the price of fixing it (only where the plan catalogue gives one) and a link
 * to billing. The link is a normal tab stop and the detail is read with it, so
 * hover is never the only way in.
 */
export function CopilotCreditsLock({ credits }: { credits: Exclude<AiCreditsState, 'available'> }) {
  const detailId = useId()
  const billingEnabled = useBillingEnabled()
  const canBill = usePermission(PERMISSIONS.BILLING_MANAGE)
  const catalogue = useQuery({ ...billingQueries.catalogue(), enabled: billingEnabled })
  const offer = copilotCreditsOffer((catalogue.data ?? null) as BillingCatalogue | null, credits)
  return (
    <div className="group flex max-w-md flex-col items-center gap-2 rounded-xl border bg-popover px-4 py-3 text-center text-sm text-popover-foreground shadow-lg [--ring:var(--muted-foreground)]">
      <p className="flex items-center gap-2 font-medium">
        <LockClosedIcon className="size-4 shrink-0" aria-hidden="true" />
        <FormattedMessage id="ask.locked.title" defaultMessage="Copilot needs AI credits" />
      </p>
      <p id={detailId} className="text-xs text-muted-foreground">
        {credits === 'used' ? (
          <FormattedMessage
            id="ask.locked.used"
            defaultMessage="This month's AI credits are used up."
          />
        ) : (
          <FormattedMessage
            id="ask.locked.none"
            defaultMessage="Your plan does not include AI credits."
          />
        )}{' '}
        {offer ? <OfferLine offer={offer} /> : null}
      </p>
      {billingEnabled && canBill ? (
        <Link
          to="/admin/settings/billing"
          search={{ checkout: undefined, billing_error: undefined }}
          aria-describedby={detailId}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {credits === 'used' ? (
            <FormattedMessage id="ask.locked.addCredits" defaultMessage="Add credits" />
          ) : (
            <FormattedMessage id="ask.locked.upgrade" defaultMessage="Upgrade" />
          )}
        </Link>
      ) : billingEnabled ? (
        <p className="text-xs text-muted-foreground">
          <FormattedMessage
            id="ask.locked.askOwner"
            defaultMessage="Ask a workspace owner to add credits."
          />
        </p>
      ) : null}
    </div>
  )
}
