import { useId, useState, type KeyboardEvent } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { Sheet, SheetContent, SheetFooter, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { CopyButton } from '@/components/shared/copy-button'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'
import { sendInvitationFn } from '@/lib/server/functions/admin'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Split pasted or typed text into email candidates. */
export function parseInviteEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

export function isInviteEmail(value: string): boolean {
  return EMAIL_RE.test(value)
}

/** What a chip that will not send is missing, in the words the sheet shows. */
export type InviteEmailProblem = 'at' | 'end' | 'format'

export function inviteEmailProblem(value: string): InviteEmailProblem | null {
  if (isInviteEmail(value)) return null
  const at = value.split('@').length - 1
  if (at === 0) return 'at'
  if (at === 1 && /^[^\s@]+@[^\s@.]+$/.test(value)) return 'end'
  return 'format'
}

/** A refusal because every seat is taken (pending invites hold seats too). */
function isSeatLimitError(message: string | undefined): boolean {
  return !!message && /seat/i.test(message)
}

type InviteRole = 'member' | 'admin'

interface InviteResult {
  email: string
  ok: boolean
  /** Only when the email could not be sent: the invitee's own link to share. */
  inviteLink?: string
  error?: string
  seatLimit?: boolean
}

export function InviteTeamSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[480px]">
        <header className="border-b px-5 py-4 pr-12">
          <SheetTitle>
            <FormattedMessage id="onboarding.live.invite.title" defaultMessage="Invite your team" />
          </SheetTitle>
        </header>
        {open && <InviteTeamBody onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function InviteTeamBody({ onDone }: { onDone: () => void }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const reasonId = useId()
  const [draft, setDraft] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [role, setRole] = useState<InviteRole>('member')
  const [results, setResults] = useState<InviteResult[]>([])
  const team = useQuery(settingsQueries.teamMembersAndInvitations())
  const seats = team.data?.seatUsage

  const addFrom = (text: string) => {
    const next = parseInviteEmails(text)
    if (next.length === 0) return
    setEmails((prev) => [...new Set([...prev, ...next])])
    setDraft('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(event.key) && draft.trim()) {
      event.preventDefault()
      addFrom(draft)
    } else if (event.key === 'Backspace' && !draft && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1))
    }
  }

  const invite = useMutation({
    mutationFn: async (list: string[]): Promise<InviteResult[]> => {
      const out: InviteResult[] = []
      for (const email of list) {
        try {
          const result = await sendInvitationFn({ data: { email, role } })
          out.push({ email, ok: true, inviteLink: result.inviteLink })
        } catch (error) {
          const message = error instanceof Error ? error.message : undefined
          out.push({ email, ok: false, error: message, seatLimit: isSeatLimitError(message) })
        }
      }
      return out
    },
    onSuccess: (out) => {
      setResults(out)
      // Sent addresses leave; failed ones and any that never went stay to fix.
      const sentNow = new Set(out.filter((r) => r.ok).map((r) => r.email))
      setEmails((prev) => [...new Set([...prev, ...out.map((r) => r.email)])].filter((e) => !sentNow.has(e)))
      void queryClient.invalidateQueries({ queryKey: adminQueries.onboardingStatus().queryKey })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'team'] })
      void queryClient.invalidateQueries({ queryKey: settingsQueries.teamMembersAndInvitations().queryKey })
    },
  })

  const pending = [...new Set([...emails, ...(draft.trim() ? parseInviteEmails(draft) : [])])]
  const valid = pending.filter(isInviteEmail)
  const problems = pending
    .map((email) => ({ email, problem: inviteEmailProblem(email) }))
    .filter((p): p is { email: string; problem: InviteEmailProblem } => p.problem !== null)
  const reasonFor = (email: string) => `${reasonId}-${pending.indexOf(email)}`
  const sent = results.filter((r) => r.ok)
  const seatsLeft = seats && seats.limit != null ? Math.max(0, seats.limit - seats.used) : null
  const overSeats = seatsLeft !== null && valid.length > seatsLeft

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div className="space-y-2">
          <label htmlFor="invite-emails" className="text-sm font-medium">
            <FormattedMessage id="onboarding.live.invite.emails" defaultMessage="Email addresses" />
          </label>
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 focus-within:border-muted-foreground/40">
            {emails.map((email) => {
              const ok = isInviteEmail(email)
              return (
                <span
                  key={email}
                  data-testid="invite-chip"
                  aria-invalid={ok ? undefined : true}
                  aria-describedby={ok ? undefined : reasonFor(email)}
                  className={
                    ok
                      ? 'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'
                      : 'inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive'
                  }
                >
                  {email}
                  <button
                    type="button"
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => setEmails((prev) => prev.filter((e) => e !== email))}
                    aria-label={intl.formatMessage(
                      { id: 'onboarding.live.invite.remove', defaultMessage: 'Remove {email}' },
                      { email }
                    )}
                  >
                    <XMarkIcon className="size-3" />
                  </button>
                </span>
              )
            })}
            <Input
              id="invite-emails"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => addFrom(draft)}
              onPaste={(event) => {
                event.preventDefault()
                addFrom(event.clipboardData.getData('text'))
              }}
              placeholder={
                emails.length
                  ? ''
                  : intl.formatMessage({
                      id: 'onboarding.live.invite.placeholder',
                      defaultMessage: 'name@company.com',
                    })
              }
              className="h-7 min-w-[10rem] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
            />
          </div>
          <div role="status" className="space-y-1 text-sm text-destructive">
            {problems.map(({ email, problem }) => (
              <p key={email} id={reasonFor(email)}>
                {problem === 'at' ? (
                  <FormattedMessage
                    id="onboarding.live.invite.problem.at"
                    defaultMessage="{email} is missing an @."
                    values={{ email }}
                  />
                ) : problem === 'end' ? (
                  <FormattedMessage
                    id="onboarding.live.invite.problem.end"
                    defaultMessage="{email} is missing the end, like {example}."
                    values={{ email, example: `${email}.com` }}
                  />
                ) : (
                  <FormattedMessage
                    id="onboarding.live.invite.problem.format"
                    defaultMessage="{email} is not an email address."
                    values={{ email }}
                  />
                )}
              </p>
            ))}
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            <FormattedMessage id="onboarding.live.invite.role" defaultMessage="Role" />
          </legend>
          <RadioGroup
            value={role}
            onValueChange={(value) => setRole(value as InviteRole)}
            className="gap-2"
          >
            {(['member', 'admin'] as const).map((value) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <RadioGroupItem value={value} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">
                    {value === 'member' ? (
                      <FormattedMessage id="onboarding.live.invite.member" defaultMessage="Member" />
                    ) : (
                      <FormattedMessage id="onboarding.live.invite.admin" defaultMessage="Admin" />
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {value === 'member' ? (
                      <FormattedMessage
                        id="onboarding.live.invite.memberHint"
                        defaultMessage="Works in your inbox and boards. No settings or billing."
                      />
                    ) : (
                      <FormattedMessage
                        id="onboarding.live.invite.adminHint"
                        defaultMessage="Everything, including settings and billing."
                      />
                    )}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.live.invite.customRoles"
              defaultMessage="Custom roles are in <link>Members</link> settings."
              values={{
                link: (chunks: React.ReactNode) => (
                  <Link to="/admin/settings/members" className="underline underline-offset-2">
                    {chunks}
                  </Link>
                ),
              }}
            />
          </p>
        </fieldset>

        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.live.invite.expiry"
            defaultMessage="Each invite is an email that works for 30 days."
          />
        </p>

        {seats && seats.limit != null && (
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
              <span>
                <FormattedMessage
                  id="onboarding.live.invite.seats"
                  defaultMessage="Seats: {used} of {limit} used, counting pending invites"
                  values={{ used: seats.used, limit: seats.limit }}
                />
              </span>
              <Link
                to="/admin/settings/billing"
                search={{ checkout: undefined, billing_error: undefined }}
                className="shrink-0 underline underline-offset-2"
              >
                <FormattedMessage id="onboarding.live.invite.manageSeats" defaultMessage="Manage seats" />
              </Link>
            </div>
            {overSeats && (
              <p role="alert" className="text-destructive">
                {seatsLeft === 0 ? (
                  <FormattedMessage
                    id="onboarding.live.invite.noSeatsLeft"
                    defaultMessage="No seats left. Remove an address or add seats."
                  />
                ) : (
                  <FormattedMessage
                    id="onboarding.live.invite.overSeats"
                    defaultMessage="{left, plural, one {# seat left} other {# seats left}}. Remove an address or add seats."
                    values={{ left: seatsLeft }}
                  />
                )}
              </p>
            )}
          </div>
        )}

        {results.length > 0 && (
          <ul className="space-y-2 text-sm" data-testid="invite-results">
            {results.map((r) => (
              <li key={r.email} className="space-y-1">
                <span className={r.ok ? 'text-foreground' : 'text-destructive'}>
                  {r.ok ? (
                    <FormattedMessage
                      id="onboarding.live.invite.sentTo"
                      defaultMessage="Invited {email}"
                      values={{ email: r.email }}
                    />
                  ) : r.seatLimit ? (
                    <FormattedMessage
                      id="onboarding.live.invite.noSeat"
                      defaultMessage="No seat left for {email}. Add seats to invite them."
                      values={{ email: r.email }}
                    />
                  ) : (
                    (r.error ?? r.email)
                  )}
                </span>
                {r.inviteLink && (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1">
                    <code className="min-w-0 flex-1 truncate text-xs">{r.inviteLink}</code>
                    <CopyButton value={r.inviteLink} variant="ghost" size="sm" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <SheetFooter className="flex-row justify-end gap-2 border-t p-4">
        {sent.length > 0 && (
          <Button variant="outline" onClick={onDone}>
            <FormattedMessage id="onboarding.live.install.done" defaultMessage="Done" />
          </Button>
        )}
        <Button
          disabled={valid.length === 0 || overSeats || invite.isPending}
          onClick={() => {
            addFrom(draft)
            invite.mutate(valid)
          }}
        >
          {valid.length === 0 ? (
            <FormattedMessage id="onboarding.live.invite.send" defaultMessage="Send invites" />
          ) : (
            <FormattedMessage
              id="onboarding.live.invite.sendCount"
              defaultMessage="Send {count, plural, one {# invite} other {# invites}}"
              values={{ count: valid.length }}
            />
          )}
        </Button>
      </SheetFooter>
    </>
  )
}
