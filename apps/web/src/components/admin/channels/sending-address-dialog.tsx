/**
 * Add a sending address, or rename one. The dialog shell loads with the page;
 * the form, with its Verified domain picker, loads when the dialog first
 * opens (`sending-address-form.tsx`), so pages that only list addresses do not
 * ship it.
 */
import { lazy, Suspense } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type {
  EmailChannelConfigDTO,
  SendingDomainDTO,
} from '@/lib/server/functions/channel-accounts'

const SendingAddressForm = lazy(() =>
  import('./sending-address-form').then((m) => ({ default: m.SendingAddressForm }))
)

/** What the dialog is open for: a new address (on a domain, when one is given), or renaming one. */
export type SendingAddressDialogTarget =
  | { kind: 'add'; domain?: string }
  | { kind: 'rename'; id: string; address: string; senderName: string | null }

/**
 * The domains of the platform's own addresses (the workspace's inbox on it and
 * the address email leaves from by default), which need no setup to send from.
 */
export const ownDomains = (...addresses: Array<string | null | undefined>): string[] =>
  addresses.flatMap((a) => {
    const domain = /@([^\s<>@]+)>?\s*$/.exec(a ?? '')?.[1]?.toLowerCase()
    return domain ? [domain] : []
  })

/** Which addresses the server takes: see `SendingAddressMode`. */
export type AddressMode = EmailChannelConfigDTO['addressMode']

/** What the dialog needs to read an address's domain as the server will. */
export type DomainContext = {
  /** The workspace's sending domains, in whatever state. */
  domains?: SendingDomainDTO[]
  /**
   * `verified-domains`: shared, so an address has to be on a Verified domain
   * and waits for its sending records before it sends. `any`: one workspace,
   * any address. `unavailable`: no custom addresses. Absent reads as `any`.
   */
  addressMode?: AddressMode
  /** Domains that need no setup: the platform's own, which it already sends from. */
  ownDomains?: readonly string[]
  /** Reads the workspace's Verified domains; without it, or when it fails, they are unreadable. */
  loadVerifiedDomains?: () => Promise<readonly string[]>
  /** Goes to Settings > Domains with Add domain open; only for a viewer who may add one. */
  onAddDomain?: () => void
}

export function SendingAddressDialog({
  target,
  workspaceName,
  onClose,
  onAdded,
  finalFocus,
  ...context
}: {
  target: SendingAddressDialogTarget | null
  workspaceName: string
  onClose: () => void
  /** Called once an address is added, before the dialog closes. */
  onAdded?: () => void
  /**
   * Where focus goes when the dialog closes. Needed when a plain button opened
   * it: nothing else knows to send focus back there, and it lands on the page.
   */
  finalFocus?: () => HTMLElement | null | true
} & DomainContext) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" finalFocus={finalFocus}>
        {target ? (
          <Suspense fallback={null}>
            <SendingAddressForm
              key={target.kind === 'rename' ? target.id : 'add'}
              target={target}
              workspaceName={workspaceName}
              onClose={onClose}
              onAdded={onAdded}
              {...context}
            />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
