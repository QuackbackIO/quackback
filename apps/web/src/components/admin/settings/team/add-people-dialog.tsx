import {
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from '@tanstack/react-router'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { CheckIcon, EnvelopeIcon, XMarkIcon } from '@heroicons/react/24/solid'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { FormError } from '@/components/shared/form-error'
import { CopyButton } from '@/components/shared/copy-button'
import { cn } from '@/lib/shared/utils'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { usersKeys } from '@/lib/client/hooks/use-users-queries'
import {
  cancelInvitationFn,
  removeTeamMemberFn,
  resendInvitationFn,
} from '@/lib/server/functions/admin'
import {
  addTeamMembersFn,
  getTeamSeatsFn,
  searchPeopleToAddFn,
} from '@/lib/server/functions/team-people'
import type { InviteId } from '@quackback/ids'
import {
  chipKey,
  checkSeats,
  extractEmails,
  isFullEmail,
  peopleCount,
  INVITE_VALID_DAYS,
  primaryLabel,
  seatOverMessage,
  seatRefusalMessage,
  successMessage,
  summarySentences,
  type AddChip,
  type PersonChip,
  type RoleChoice,
} from '@/components/admin/settings/team/add-people'
import { RoleNotes, RoleSelect, useRoleChoice } from '@/components/admin/settings/team/role-select'

const SEARCH_DEBOUNCE_MS = 250

type SearchResult = Awaited<ReturnType<typeof searchPeopleToAddFn>>
type FoundPerson = SearchResult['people'][number]
type AddResponse = Awaited<ReturnType<typeof addTeamMembersFn>>
type AddResult = Extract<AddResponse, { ok: true }>
type AddRefusal = Extract<AddResponse, { ok: false }>

/** An address that already has an invitation waiting. */
interface PendingInvite {
  address: string
  invitationId: string
  invitedAt?: string | Date
  roleName: string | null
}

/** One row of the results list. */
type ResultOption =
  | { kind: 'person'; id: string; person: FoundPerson; disabled: boolean }
  | { kind: 'invite'; id: string; address: string; disabled: false }
  | { kind: 'teammate-email'; id: string; address: string; disabled: true }

export interface AddPeopleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether the person adding may grant Admin. Only admins can. */
  canGrantAdmin: boolean
  /** Opens with this person already chosen (a person's detail page). */
  initialPerson?: Omit<PersonChip, 'kind'>
  /** After people were added or invited, with the role they got. */
  onAdded?: (result: AddResult, role: RoleChoice) => void
  /** After the success toast's Undo put everything back. */
  onUndone?: () => void
  /** Names the workspace in the title: "Add people to Acme". */
  workspaceName?: string
}

/**
 * Add people to the team: find people who have signed in and add them now,
 * or type emails to invite someone new. One dialog for the Members page and
 * a person's detail page.
 */
export function AddPeopleDialog({ open, onOpenChange, ...rest }: AddPeopleDialogProps) {
  // A fresh form each time the dialog opens, so nothing from the last use lingers.
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSession((s) => s + 1)
  }

  const { workspaceName, ...formProps } = rest
  const title = rest.initialPerson
    ? `Make ${rest.initialPerson.name} a teammate`
    : workspaceName
      ? `Add people to ${workspaceName}`
      : 'Add people'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <AddPeopleForm key={session} onClose={() => onOpenChange(false)} {...formProps} />
      </DialogContent>
    </Dialog>
  )
}

function AddPeopleForm({
  canGrantAdmin,
  initialPerson,
  onAdded,
  onUndone,
  onClose,
}: Omit<AddPeopleDialogProps, 'open' | 'onOpenChange' | 'workspaceName'> & {
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [chips, setChips] = useState<AddChip[]>(() =>
    initialPerson ? [{ kind: 'person', ...initialPerson }] : []
  )
  const [query, setQuery] = useState('')
  const [roleValue, setRoleValue] = useState<string>('member')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{
    code: AddRefusal['code'] | null
    message: string
    needed?: number
    free?: number
  } | null>(null)
  const [inviteLinks, setInviteLinks] = useState<Array<{ email: string; link: string }> | null>(
    null
  )

  const role = useRoleChoice(roleValue)

  const { data: seats } = useQuery({
    queryKey: ['settings', 'team', 'seats'],
    queryFn: () => getTeamSeatsFn(),
    staleTime: 30 * 1000,
  })
  const seatCheck = checkSeats(seats, chips.length)

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings', 'team'] }),
      queryClient.invalidateQueries({ queryKey: usersKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['add-people'] }),
    ])
  }

  const undo = async (result: AddResult) => {
    try {
      await Promise.all([
        ...result.added.map((p) => removeTeamMemberFn({ data: { principalId: p.principalId } })),
        ...result.invited.map((i) =>
          cancelInvitationFn({ data: { invitationId: i.invitationId as InviteId } })
        ),
      ])
      await invalidate()
      onUndone?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't undo. Try again.")
    }
  }

  const submit = async () => {
    if (chips.length === 0 || seatCheck?.over) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await addTeamMembersFn({
        data: {
          principalIds: chips.flatMap((c) => (c.kind === 'person' ? [c.principalId] : [])),
          emails: chips.flatMap((c) => (c.kind === 'email' ? [c.address] : [])),
          role: role.role,
          ...(role.roleId ? { roleId: role.roleId } : {}),
        },
      })
      // Expected refusals come back as values; nothing was written.
      if (result.ok === false) {
        setError({
          code: result.code,
          message: result.message,
          needed: result.needed,
          free: result.free,
        })
        return
      }
      await invalidate()
      onAdded?.(result, role)
      // Without email delivery an invite goes nowhere until its link is shared,
      // so those stay on screen to copy instead of being announced as sent.
      const unsent = result.invited.flatMap((i) =>
        i.emailSent === false && i.inviteLink ? [{ email: i.email, link: i.inviteLink }] : []
      )
      const sent = result.invited.filter((i) => i.emailSent !== false)
      const message = successMessage(result.added, sent, role)
      if (message) {
        toast.success(message, {
          action: { label: 'Undo', onClick: () => void undo(result) },
        })
      }
      if (unsent.length > 0) setInviteLinks(unsent)
      else onClose()
    } catch {
      // A thrown failure is unexpected (network, server fault); its text is not for people.
      setError({ code: null, message: "Couldn't add people. Try again." })
    } finally {
      setSubmitting(false)
    }
  }

  const removeChip = (key: string) => setChips((prev) => prev.filter((c) => chipKey(c) !== key))
  const addChips = (next: AddChip[]) => {
    setError(null)
    setChips((prev) => {
      const have = new Set(prev.map(chipKey))
      return [...prev, ...next.filter((c) => !have.has(chipKey(c)))]
    })
  }

  if (inviteLinks) return <InviteLinks links={inviteLinks} onDone={onClose} />

  const over = seatCheck?.over ?? false
  const seatError = error?.code === 'SEAT_LIMIT'
  const roleError = error?.code === 'GRANT_CEILING'

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {error && !seatError && !roleError && <FormError message={error.message} />}

      <PeopleField
        chips={chips}
        onAdd={addChips}
        onRemove={removeChip}
        query={query}
        onQueryChange={setQuery}
      />

      <div className="space-y-1.5">
        <Label htmlFor="add-people-role">Role</Label>
        <RoleSelect
          id="add-people-role"
          value={roleValue}
          onValueChange={(v) => {
            setRoleValue(v)
            if (roleError) setError(null)
          }}
          canGrantAdmin={canGrantAdmin}
          invalid={roleError}
        />
        <RoleNotes role={role} refused={roleError} />
      </div>

      {seatCheck && (
        <SeatMeter
          check={seatCheck}
          adding={chips.length}
          serverRefused={seatError ? { needed: error?.needed, free: error?.free } : null}
        />
      )}

      {chips.length > 0 && !over && (
        <ul
          aria-label="What happens"
          className="list-disc space-y-1 pl-[18px] text-[13px] leading-normal text-muted-foreground"
        >
          {summarySentences(chips, role).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={chips.length === 0 || over || submitting}>
          {submitting ? 'Adding...' : primaryLabel(chips)}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Email delivery is not set up: the invitation links to share by hand. */
function InviteLinks({
  links,
  onDone,
}: {
  links: Array<{ email: string; link: string }>
  onDone: () => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Email is not set up, so no invitation email went out. Share{' '}
        {links.length === 1 ? 'this link' : 'these links'} instead.
      </p>
      <ul className="space-y-2">
        {links.map(({ email, link }) => (
          <li key={email} className="space-y-1">
            <p className="text-[13px] font-medium text-foreground">{email}</p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2">
              <code className="flex-1 truncate text-xs">{link}</code>
              <CopyButton
                value={link}
                variant="ghost"
                size="sm"
                aria-label={`Copy invitation link for ${email}`}
              />
            </div>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  )
}

function SeatMeter({
  check,
  adding,
  serverRefused,
}: {
  check: NonNullable<ReturnType<typeof checkSeats>>
  adding: number
  /** The server's seat refusal, with its counts when it sent them. */
  serverRefused: { needed?: number; free?: number } | null
}) {
  const over = check.over
  const percent =
    check.limit != null && check.limit > 0 ? Math.min(100, (check.needed / check.limit) * 100) : 0
  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border px-3 py-2 text-xs text-muted-foreground',
          over ? 'border-warning/40 bg-warning/10' : 'border-border/50 bg-muted/30'
        )}
      >
        <span className="shrink-0">Team seats</span>
        {check.limit != null ? (
          <>
            <span
              role="progressbar"
              aria-label="Team seats"
              aria-valuemin={0}
              aria-valuemax={check.limit}
              aria-valuenow={Math.min(check.needed, check.limit)}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn('block h-full', over ? 'bg-warning' : 'bg-primary')}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className={cn('shrink-0 font-mono tabular-nums', over && 'text-warning')}>
              {check.needed} / {check.limit}
            </span>
          </>
        ) : (
          <span className="ml-auto font-mono tabular-nums">{check.needed} used</span>
        )}
      </div>
      {over ? (
        <p role="alert" className="text-[13px] leading-snug text-warning">
          {seatOverMessage(adding, check)} <BillingLink />.
        </p>
      ) : serverRefused ? (
        <p role="alert" className="text-[13px] leading-snug text-warning">
          {serverRefused.needed != null && serverRefused.free != null ? (
            <>
              {seatRefusalMessage(serverRefused.needed, serverRefused.free)} <BillingLink />.
            </>
          ) : (
            <>
              The plan has no seats left for {peopleCount(adding)}. Remove someone, or{' '}
              <BillingLink />.
            </>
          )}
        </p>
      ) : null}
    </div>
  )
}

function BillingLink() {
  return (
    <Link
      to="/admin/settings/billing"
      search={{ checkout: undefined, billing_error: undefined }}
      className="underline underline-offset-2"
    >
      add seats in Plan &amp; billing
    </Link>
  )
}

/**
 * The People field: chosen people and emails as chips, then a search box
 * with ARIA combobox semantics over the results list below it.
 */
function PeopleField({
  chips,
  onAdd,
  onRemove,
  query,
  onQueryChange,
}: {
  chips: AddChip[]
  onAdd: (chips: AddChip[]) => void
  onRemove: (key: string) => void
  query: string
  onQueryChange: (query: string) => void
}) {
  const inputId = useId()
  const listId = useId()
  const helpId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)

  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS)
  const search = useQuery({
    queryKey: ['add-people', 'search', debounced],
    queryFn: () => searchPeopleToAddFn({ data: { query: debounced } }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
  // Until the first answer, assume search is allowed; the answer says otherwise.
  const canSearchPeople = search.data?.canSearchPeople ?? true
  const settled = search.data != null && debounced === trimmed && !search.isPlaceholderData

  const chosen = useMemo(() => new Set(chips.map(chipKey)), [chips])

  const { options, pendingInvite } = useMemo(() => {
    // People from the last answer stay listed while the next search runs; the
    // email row waits for the answer about exactly what is typed.
    const result = search.data
    const opts: ResultOption[] = []
    let pending: PendingInvite | null = null
    if (!result) return { options: opts, pendingInvite: pending }
    if (result.canSearchPeople) {
      for (const person of result.people) {
        if (chosen.has(`p:${person.principalId}`)) continue
        opts.push({
          kind: 'person',
          id: `person-${person.principalId}`,
          person,
          disabled: person.status !== 'portal_user',
        })
      }
    }
    const email = result.email
    if (email && settled && isFullEmail(trimmed)) {
      const address = email.address.toLowerCase()
      if (email.status === 'new' && !chosen.has(`e:${address}`)) {
        opts.push({ kind: 'invite', id: `invite-${address}`, address, disabled: false })
      } else if (email.status === 'member') {
        opts.push({ kind: 'teammate-email', id: `mate-${address}`, address, disabled: true })
      } else if (
        email.status === 'portal_user' &&
        email.principalId &&
        !opts.some((o) => o.kind === 'person' && o.person.principalId === email.principalId) &&
        !chosen.has(`p:${email.principalId}`)
      ) {
        opts.push({
          kind: 'person',
          id: `person-${email.principalId}`,
          person: {
            principalId: email.principalId,
            name: email.address,
            avatarUrl: null,
            detail: email.address,
            status: 'portal_user',
          },
          disabled: false,
        })
      } else if (email.status === 'pending_invite' && email.invitationId) {
        pending = {
          address,
          invitationId: email.invitationId,
          invitedAt: email.invitedAt,
          // The invite's role, when the search answer carries it.
          roleName: (email as { roleName?: string | null }).roleName ?? null,
        }
      }
    }
    return { options: opts, pendingInvite: pending }
  }, [settled, search.data, trimmed, chosen])

  const enabledIndexes = options.flatMap((o, i) => (o.disabled ? [] : [i]))
  const activeIndex = enabledIndexes.includes(active) ? active : (enabledIndexes[0] ?? -1)
  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined

  const showPanel = focused && (options.length > 0 || pendingInvite != null)
  const recent = trimmed === '' && canSearchPeople

  const choose = (option: ResultOption) => {
    if (option.disabled) return
    if (option.kind === 'person') {
      onAdd([
        {
          kind: 'person',
          principalId: option.person.principalId,
          name: option.person.name,
          avatarUrl: option.person.avatarUrl,
          detail: option.person.detail,
        },
      ])
    } else if (option.kind === 'invite') {
      onAdd([{ kind: 'email', address: option.address }])
    }
    onQueryChange('')
    setActive(0)
    inputRef.current?.focus()
  }

  const move = (delta: 1 | -1) => {
    if (enabledIndexes.length === 0) return
    const at = enabledIndexes.indexOf(activeIndex)
    const next = (at + delta + enabledIndexes.length) % enabledIndexes.length
    setActive(enabledIndexes[next])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocused(true)
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted result; it never submits the dialog from here.
      e.preventDefault()
      if (showPanel && activeOption) choose(activeOption)
    } else if (e.key === 'Backspace' && query === '' && chips.length > 0) {
      onRemove(chipKey(chips[chips.length - 1]))
    } else if (e.key === 'Escape' && query !== '') {
      // Clear the search first; a second Escape closes the dialog.
      e.preventDefault()
      e.stopPropagation()
      onQueryChange('')
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const emails = extractEmails(e.clipboardData.getData('text'))
    if (emails.length < 2) return
    e.preventDefault()
    onAdd(emails.map((address) => ({ kind: 'email', address })))
    onQueryChange('')
  }

  const help = canSearchPeople
    ? 'Search people who have signed in, or type a full email to invite someone new. You can paste several emails.'
    : 'Type a full email to invite someone. You can paste several emails.'

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>People</Label>
      <div
        className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-field border border-input px-2 py-1.5 focus-within:border-ring"
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map((chip) => (
          <Chip key={chipKey(chip)} chip={chip} onRemove={() => onRemove(chipKey(chip))} />
        ))}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={showPanel && activeOption ? activeOption.id : undefined}
          aria-describedby={helpId}
          placeholder={
            chips.length > 0
              ? 'Add more people'
              : canSearchPeople
                ? 'Name, username, account ID or email'
                : 'Email address'
          }
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setActive(0)
            setFocused(true)
          }}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (panelRef.current?.contains(e.relatedTarget as Node | null)) return
            setFocused(false)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p id={helpId} className="text-xs text-muted-foreground">
        {help}
      </p>
      <div
        ref={panelRef}
        hidden={!showPanel}
        className="max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
      >
        <div id={listId} role="listbox" aria-label={recent ? 'Recently active' : 'People'}>
          {recent && options.length > 0 && (
            <div
              role="presentation"
              className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground"
            >
              Recently active
            </div>
          )}
          {options.map((option, i) => (
            <ResultRow
              key={option.id}
              option={option}
              active={i === activeIndex}
              onHover={() => !option.disabled && setActive(i)}
              onChoose={() => choose(option)}
            />
          ))}
        </div>
        {pendingInvite && <PendingInviteRow invite={pendingInvite} />}
      </div>
    </div>
  )
}

function ResultRow({
  option,
  active,
  onHover,
  onChoose,
}: {
  option: ResultOption
  active: boolean
  onHover: () => void
  onChoose: () => void
}) {
  let icon: ReactNode
  let title: string
  let detail: string | null = null
  let trailing: string | null = null
  if (option.kind === 'person') {
    const p = option.person
    icon = (
      <Avatar
        src={p.avatarUrl}
        name={p.name}
        className={cn('size-8 text-xs', option.disabled && 'opacity-50')}
      />
    )
    title = p.name
    detail = p.detail || null
    trailing =
      p.status === 'admin'
        ? 'Already an Admin'
        : p.status === 'member'
          ? 'Already a Member'
          : 'Portal user'
  } else {
    icon = <EnvelopeAvatar />
    title = option.kind === 'invite' ? `Invite ${option.address}` : option.address
    detail =
      option.kind === 'invite'
        ? `Nobody with this email has signed in. They get an email invitation for ${INVITE_VALID_DAYS} days.`
        : null
    trailing = option.kind === 'teammate-email' ? 'Already on the team' : null
  }
  return (
    <div
      id={option.id}
      role="option"
      aria-selected={active}
      aria-disabled={option.disabled || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onChoose}
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
        active && 'bg-accent',
        option.disabled && 'text-muted-foreground'
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
      {trailing && <span className="shrink-0 text-xs text-muted-foreground">{trailing}</span>}
    </div>
  )
}

function EnvelopeAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
      <EnvelopeIcon className="size-4 text-muted-foreground" aria-hidden />
    </span>
  )
}

function PendingInviteRow({ invite }: { invite: PendingInvite }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const when = invite.invitedAt
    ? formatDistanceToNow(new Date(invite.invitedAt), { addSuffix: true })
    : null

  const resend = async () => {
    setState('sending')
    try {
      const result = await resendInvitationFn({
        data: { invitationId: invite.invitationId as InviteId },
      })
      setState('sent')
      if (result.emailSent === false && result.inviteLink) {
        const link = result.inviteLink
        toast('Email is not set up, so no email went out.', {
          action: { label: 'Copy link', onClick: () => void navigator.clipboard?.writeText(link) },
        })
      }
    } catch (err) {
      setState('idle')
      toast.error(err instanceof Error ? err.message : "Couldn't resend. Try again.")
    }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm">
      <EnvelopeAvatar />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{invite.address}</span>
        <span className="block text-xs text-muted-foreground">
          {`${['Invited', when, invite.roleName && `as ${invite.roleName}`].filter(Boolean).join(' ')}, not accepted yet`}
        </span>
      </span>
      {state === 'sent' ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <CheckIcon className="size-3.5" />
          Sent
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state === 'sending'}
          onClick={() => void resend()}
        >
          Resend invite
        </Button>
      )}
    </div>
  )
}

function Chip({ chip, onRemove }: { chip: AddChip; onRemove: () => void }) {
  const label = chip.kind === 'person' ? chip.name : chip.address
  return (
    <span
      className={cn(
        'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-1 text-[13px]',
        chip.kind === 'person' ? 'border-transparent bg-muted' : 'border-border bg-background'
      )}
    >
      {chip.kind === 'person' ? (
        <Avatar src={chip.avatarUrl} name={chip.name} className="size-5 text-[11px]" />
      ) : (
        <EnvelopeIcon className="ml-0.5 size-4 text-muted-foreground" aria-hidden />
      )}
      <span className="truncate">{label}</span>
      {chip.kind === 'email' && <span className="text-[11px] text-muted-foreground">invite</span>}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <XMarkIcon className="size-3" />
      </button>
    </span>
  )
}
