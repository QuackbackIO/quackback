/**
 * Which address email is sent from: the workspace default, and beside it only
 * the kinds of email (support, the feedback board, the changelog, the status
 * page) that send from something else. Support can also reply from the
 * address the customer wrote to, once the workspace receives email.
 */
import { useState } from 'react'
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSetEmailSender } from '@/lib/client/mutations/channel-accounts'
import type { EmailSenderChoiceDTO, EmailSendersDTO } from '@/lib/server/functions/channel-accounts'

/** An address the page can offer, already named and checked. */
export type SenderIdentity = {
  id: string
  /** "Sender name <address>". */
  label: string
  /** Whether its domain is verified, so mail actually sends from it. */
  live: boolean
  /** Not live because its domain was verified once and stopped, not because it never was. */
  lapsed?: boolean
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

/** The domain of an address, which is what gets verified. */
const domainOf = (address: string): string => address.slice(address.lastIndexOf('@') + 1)

/** How long a stand-in lasts: a new address is waiting, a lapsed one needs a fix. */
const untilWhen = (identity: SenderIdentity): string =>
  identity.lapsed ? "until it's fixed" : 'for now'

/** "help@acme.com isn't verified yet", or "is no longer verified" once it was. */
const cannotSend = (identity: SenderIdentity): string =>
  `${addressOf(identity.label)} ${identity.lapsed ? 'is no longer verified' : "isn't verified yet"}`

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
  description = 'The address your email comes from.',
  action,
  id,
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
  /** An anchor for a link that lands on this card. */
  id?: string
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
      ? `Email comes from ${platformFrom}.`
      : "No default address is set, so email can't be sent until you choose one."
  // A chosen address whose domain stopped verifying (or never finished) is
  // still shown as chosen; this says what mail goes out from meanwhile.
  const notLiveHint = (surface: Surface): string | undefined => {
    const choice = senders[surface]
    if (choice?.mode !== 'address') return undefined
    const identity = identities.find((i) => i.id === choice.id)
    const fallback = surface === 'default' ? platformFrom : resolvedDefault
    if (!identity || identity.live || !fallback) return undefined
    return `${cannotSend(identity)}, so email comes from ${fallback} ${untilWhen(identity)}.`
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
      ? `${domainOf(forwardingTarget)} isn't verified, so replies come from ${inboxFallback}.`
      : undefined
  const behindInboxHint = !behindInbox
    ? undefined
    : behindInbox.live
      ? `Conversations not started by email use ${behindInbox.label}.`
      : resolvedDefault
        ? `${cannotSend(behindInbox)}, so conversations not started by email use ${resolvedDefault} ${untilWhen(behindInbox)}.`
        : undefined

  const showDefault = rows.includes('default')
  const surfaces = OVERRIDES.filter(({ surface }) => rows.includes(surface))
  // Support can reply from the inbox only while the workspace has one.
  const offersInbox = (surface: Surface) => surface === 'support' && hasInboundRoute
  // A kind of email sends from its own choice: an address, or the inbox where
  // there is one. Anything else is the default.
  const isException = (surface: Surface) => {
    const choice = senders[surface]
    return choice?.mode === 'address' || (choice?.mode === 'inbox' && offersInbox(surface))
  }

  // Beside the default, only the kinds of email that differ from it are listed,
  // so a workspace that sends everything from one address sees one row. A kind
  // picked from the menu is listed without a choice until one is made.
  const [picked, setPicked] = useState<Surface[]>([])
  const listed = showDefault
    ? surfaces.filter(({ surface }) => isException(surface) || picked.includes(surface))
    : surfaces
  const addable = showDefault
    ? surfaces.filter(
        ({ surface }) =>
          !listed.some((l) => l.surface === surface) &&
          (optionsFor(surface).length > 0 || offersInbox(surface))
      )
    : []
  const drop = (surface: Surface) => {
    setPicked((current) => current.filter((s) => s !== surface))
    if (senders[surface]) setSender.mutate({ surface, choice: null }, { onError })
  }

  const row = ({ surface, label }: (typeof OVERRIDES)[number]) => {
    const id = `send-from-${surface}`
    const exception = isException(surface)
    // On its own page the row is the card's one setting, named for what it
    // does; beside the default it is named for the kind of email.
    const rowLabel = !showDefault && surface === 'support' ? 'Reply from' : label
    const value = exception
      ? valueOf(senders[surface], surface)
      : showDefault
        ? ''
        : SAME_AS_DEFAULT
    return (
      <SettingRow
        key={surface}
        label={rowLabel}
        htmlFor={id}
        description={
          (surface === 'support' ? (supportHint ?? behindInboxHint) : undefined) ??
          notLiveHint(surface) ??
          (!showDefault && !exception && resolvedDefault
            ? `${surface === 'support' ? 'Replies come' : 'Email comes'} from ${resolvedDefault}.`
            : undefined)
        }
        control={
          <>
            <Select
              value={value}
              disabled={setSender.isPending}
              onValueChange={(v) => choose(surface, String(v))}
            >
              <SelectTrigger id={id} className="w-72 lg:w-96" aria-label={rowLabel}>
                <SelectValue placeholder="Choose an address" />
              </SelectTrigger>
              <SelectContent>
                {offersInbox(surface) && (
                  <SelectItem value={INBOX}>Address the customer wrote to</SelectItem>
                )}
                {!showDefault && <SelectItem value={SAME_AS_DEFAULT}>Workspace default</SelectItem>}
                {optionsFor(surface).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showDefault && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Use the default for ${label}`}
                className="text-muted-foreground"
                disabled={setSender.isPending}
                onClick={() => drop(surface)}
              >
                <XMarkIcon className="size-4" />
              </Button>
            )}
          </>
        }
      />
    )
  }

  return (
    <SettingsCard id={id} title={title} description={description} action={action}>
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
                <SelectTrigger id="send-from-default" className="w-72 lg:w-96" aria-label="Default">
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
        {showDefault && listed.length > 0 && (
          <div className="py-3.5">
            <h3 className="text-xs font-medium text-muted-foreground">Except</h3>
            <SettingRows className="mt-3">{listed.map(row)}</SettingRows>
          </div>
        )}
        {!showDefault && listed.map(row)}
        {addable.length > 0 && (
          <div className="py-3.5">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <PlusIcon className="size-4" />
                Use a different address for
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {addable.map(({ surface, label }) => (
                  <DropdownMenuItem
                    key={surface}
                    onClick={() => setPicked((current) => [...current, surface])}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </SettingRows>
    </SettingsCard>
  )
}
