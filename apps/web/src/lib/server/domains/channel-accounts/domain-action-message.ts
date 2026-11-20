/**
 * The message a person is allowed to see for a failed sending-domain action.
 *
 * Our own refusals are written for the person reading them and name the fix, so
 * they pass through. Provider failures are sorted by what the reader can do
 * about them: a server that is not set up for this (nothing they can fix), a
 * provider that did not answer (try again), and everything else (try again,
 * then ask whoever can act on it). The provider's own prose never crosses
 * the wire; it names actions, exception types and services this person did not
 * ask about, and it is already in the server log for the operator.
 */
import { SesIdentityConfigError, SesIdentityError } from '@quackback/email/ses-identity'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { ChannelAddressInUseError, SendingDomainInUseError } from './channel-account.service'
import { SendingDomainRefusedError } from './sending-identity'
import { SendingIdentityRefusedError } from './outbound-identity'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'

export type DomainAction = 'address' | 'verify' | 'remove' | 'test'

const NOT_SET_UP: Record<DomainAction, string> = {
  address: "Custom sending domains aren't set up correctly on this server. Nothing was added.",
  verify:
    "Custom sending domains aren't set up correctly on this server, so the records weren't checked.",
  remove: "Custom sending domains aren't set up correctly on this server. Nothing was removed.",
  test: "Custom sending domains aren't set up correctly on this server, so nothing was sent.",
}

const UNREACHABLE = "Couldn't reach the email provider. Try again in a minute."

const FAILED: Record<DomainAction, string> = {
  address: "Couldn't add the address.",
  verify: "Couldn't check the records.",
  remove: "Couldn't remove the domain.",
  test: "Couldn't send the test email.",
}

/**
 * Who can act when trying again does not help: on a server shared by many
 * workspaces, the people who run it; on a workspace's own server, whoever
 * administers it.
 */
const whoToAsk = (): string =>
  isPooledTenancy() ? 'contact support' : 'contact your administrator'

/** Whether the failure is this server's setup rather than the request. */
function isSetupFailure(error: unknown): boolean {
  if (error instanceof SesIdentityConfigError) return true
  return error instanceof SesIdentityError && error.code === 'AccessDeniedException'
}

/** Whether the message is one of ours, written for the person reading it. */
export function isDomainActionRefusal(error: unknown): boolean {
  return (
    error instanceof SendingDomainRefusedError ||
    error instanceof SendingIdentityRefusedError ||
    error instanceof SendingDomainInUseError ||
    error instanceof ChannelAddressInUseError ||
    error instanceof TierLimitError
  )
}

export function domainActionMessage(error: unknown, action: DomainAction): string {
  if (isDomainActionRefusal(error)) return (error as Error).message
  if (isSetupFailure(error)) return NOT_SET_UP[action]
  if (error instanceof SesIdentityError && error.retryable) return UNREACHABLE
  return `${FAILED[action]} Try again, and if it keeps failing, ${whoToAsk()}.`
}
