/**
 * Which address each kind of email is sent from: the workspace default, and
 * an override for support, the feedback board, the changelog and the status
 * page. Support can also reply from the address the customer wrote to, once
 * the workspace receives email.
 */
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSetEmailSender } from '@/lib/client/mutations/channel-accounts'
import type { EmailSenderChoiceDTO, EmailSendersDTO } from '@/lib/server/functions/channel-accounts'

/** An address the page can offer, already named and checked. */
export type SenderIdentity = {
  id: string
  /** "Sender name <address>". */
  label: string
  /** Whether its domain is verified, so mail actually sends from it. */
  live: boolean
}

type Surface = keyof EmailSendersDTO

/** What each kind of email with its own sender is called, in the order shown. */
export const SENDER_SURFACE_NAMES: Record<Exclude<Surface, 'default'>, string> = {
  support: 'Support',
  feedback: 'Feedback board',
  changelog: 'Changelog',
  status: 'Status page',
}

const OVERRIDES = (
  Object.keys(SENDER_SURFACE_NAMES) as Array<keyof typeof SENDER_SURFACE_NAMES>
).map((surface) => ({ surface, label: SENDER_SURFACE_NAMES[surface] }))

const ALL_ROWS: readonly Surface[] = ['default', ...OVERRIDES.map((o) => o.surface)]

const PLATFORM = '__platform'
const SAME_AS_DEFAULT = '__default'
const INBOX = '__inbox'

/** The Select value for a surface's choice. */
function valueOf(choice: EmailSenderChoiceDTO | null, surface: Surface): string {
  if (!choice) return surface === 'default' ? PLATFORM : SAME_AS_DEFAULT
  return choice.mode === 'inbox' ? INBOX : choice.id
}

/** The choice a Select value stands for. */
function choiceOf(value: string): EmailSenderChoiceDTO | null {
  if (value === PLATFORM || value === SAME_AS_DEFAULT) return null
  if (value === INBOX) return { mode: 'inbox' }
  return { mode: 'address', id: value }
}

/** The addr-spec of a "Name <address>" label: its last bracketed part. */
const addressOf = (label: string): string => /<([^<>]+)>\s*$/.exec(label)?.[1] ?? label

export function SendFromCard({
  senders,
  identities,
  platformFrom,
  platformName = 'Quackback address',
  platformInbox = null,
  forwardingTarget,
  forwardingTargetPermitted,
  hasInboundRoute,
  rows = ALL_ROWS,
  title = 'Send from',
  description = 'The address each kind of email comes from.',
  action,
  onError,
}: {
  senders: EmailSendersDTO
  identities: SenderIdentity[]
  /** "Workspace <platform address>", or null when this install has none. */
  platformFrom: string | null
  /** What the address email sends from with nothing chosen is called here. */
  platformName?: string
  /**
   * "Workspace <its inbox on the platform>", when it has one: what a reply to
   * an emailed-in conversation falls back to before the platform address.
   */
  platformInbox?: string | null
  forwardingTarget: string | null
  forwardingTargetPermitted: boolean | null
  /** Whether the workspace receives email, so support can reply from the inbox. */
  hasInboundRoute: boolean
  /**
   * The rows to show, in their usual order: the workspace page shows the
   * default and the products that are on; the support inbox page shows only
   * support. A row left out keeps its choice.
   */
  rows?: readonly Surface[]
  title?: string
  description?: string
  action?: React.ReactNode
  onError: (error: unknown) => void
}) {
  const setSender = useSetEmailSender()

  // Verified addresses, plus whatever is chosen now so a demoted one still reads.
  const optionsFor = (surface: Surface) => {
    const chosen = senders[surface]
    const chosenId = chosen?.mode === 'address' ? chosen.id : null
    return identities.filter((i) => i.live || i.id === chosenId)
  }
  const choose = (surface: Surface, value: string) =>
    setSender.mutate({ surface, choice: choiceOf(value) }, { onError })

  const defaultChoice = senders.default
  const defaultIdentity =
    defaultChoice?.mode === 'address'
      ? identities.find((i) => i.id === defaultChoice.id && i.live)
      : undefined
  // What "the default" sends from today.
  const resolvedDefault = defaultIdentity?.label ?? platformFrom

  const defaultHint = defaultChoice
    ? undefined
    : platformFrom
      ? `Email sends from ${platformFrom}.`
      : 'No default address is configured, so choose one to send email.'
  // A chosen address whose domain stopped verifying (or never finished) is
  // still shown as chosen; this says what mail goes out from meanwhile.
  const notLiveHint = (surface: Surface): string | undefined => {
    const choice = senders[surface]
    if (choice?.mode !== 'address') return undefined
    const identity = identities.find((i) => i.id === choice.id)
    const fallback = surface === 'default' ? platformFrom : resolvedDefault
    if (!identity || identity.live || !fallback) return undefined
    return `${addressOf(identity.label)} isn't verified yet, so email sends from ${fallback}.`
  }
  // The address behind the inbox, when support replies from the inbox and has
  // one: support email that is not a reply to the inbox leaves from it.
  const support = senders.support
  const behindInbox =
    support?.mode === 'inbox' && support.fallbackId
      ? identities.find((i) => i.id === support.fallbackId)
      : undefined
  // Said only when what happens differs from what is chosen. A reply that
  // cannot leave from the inbox address leaves from the address behind the
  // inbox, else the default, else the workspace's own inbox on the platform,
  // else the platform address.
  const inboxFallback =
    (behindInbox?.live ? behindInbox.label : undefined) ??
    defaultIdentity?.label ??
    platformInbox ??
    platformFrom
  const supportHint =
    support?.mode === 'inbox' &&
    forwardingTarget &&
    forwardingTargetPermitted === false &&
    inboxFallback
      ? `${forwardingTarget} isn't verified yet, so replies come from ${inboxFallback}.`
      : undefined
  const behindInboxHint = !behindInbox
    ? undefined
    : behindInbox.live
      ? `Other support email comes from ${behindInbox.label}.`
      : resolvedDefault
        ? `${addressOf(behindInbox.label)} isn't verified yet, so other support email comes from ${resolvedDefault}.`
        : undefined

  const showDefault = rows.includes('default')
  // Beside the default row "Same as default" is enough. Alone, the row's
  // description says which address that is, since the select is too narrow.
  const sameAsDefault = showDefault ? 'Same as default' : 'Workspace default'

  return (
    <SettingsCard title={title} description={description} action={action}>
      <SettingRows>
        {showDefault && (
          <SettingRow
            label="Default"
            htmlFor="send-from-default"
            description={notLiveHint('default') ?? defaultHint}
            control={
              <Select
                value={valueOf(defaultChoice, 'default')}
                disabled={setSender.isPending}
                onValueChange={(v) => choose('default', String(v))}
              >
                <SelectTrigger id="send-from-default" className="w-72" aria-label="Default">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {optionsFor('default').map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={PLATFORM}>
                    {`${platformName} (${platformFrom ?? 'not set'})`}
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />
        )}
        {OVERRIDES.filter(({ surface }) => rows.includes(surface)).map(({ surface, label }) => {
          const id = `send-from-${surface}`
          const offerInbox = surface === 'support' && hasInboundRoute
          // Support without an inbound route has no inbox to reply from.
          const value =
            senders[surface]?.mode === 'inbox' && !offerInbox
              ? SAME_AS_DEFAULT
              : valueOf(senders[surface], surface)
          return (
            <SettingRow
              key={surface}
              label={label}
              htmlFor={id}
              description={
                (surface === 'support' ? (supportHint ?? behindInboxHint) : undefined) ??
                notLiveHint(surface) ??
                (!showDefault && value === SAME_AS_DEFAULT && resolvedDefault
                  ? `Sends from ${resolvedDefault}.`
                  : undefined)
              }
              control={
                <Select
                  value={value}
                  disabled={setSender.isPending}
                  onValueChange={(v) => choose(surface, String(v))}
                >
                  <SelectTrigger id={id} className="w-72" aria-label={label}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {offerInbox && (
                      <SelectItem value={INBOX}>Address the customer wrote to</SelectItem>
                    )}
                    <SelectItem value={SAME_AS_DEFAULT}>{sameAsDefault}</SelectItem>
                    {optionsFor(surface).map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          )
        })}
      </SettingRows>
    </SettingsCard>
  )
}
