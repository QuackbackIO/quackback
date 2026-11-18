import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import {
  setKeptBoardFn,
  setKeptSendingDomainsFn,
  setSeatHoldersFn,
  setVisibleStatusComponentsFn,
  type PlanLimitsChoiceResponse,
} from '@/lib/server/functions/plan-limits'
import { planLimitsQueries } from '@/lib/client/queries/plan-limits'
import { errorText } from '@/lib/client/error-text'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/shared/utils'

export type PlanLimitsChooserKind = 'board' | 'seats' | 'statusComponents' | 'sendingDomains'

interface ChoiceItem {
  id: string
  title: string
  detail?: string
  tag?: string
  /** Always kept; shown chosen and cannot be cleared. */
  locked?: boolean
}

const REFUSAL_TEXT: Record<Exclude<PlanLimitsChoiceResponse, { ok: true }>['reason'], string> = {
  not_over: 'This fits the plan now, so there is nothing to choose.',
  unknown: 'Something in this list has changed. Close this and try again.',
  too_many: 'That is more than the plan includes. Clear one and try again.',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

interface ChooserSpec {
  title: string
  description: string
  footnote?: string
  items: ChoiceItem[]
  single: boolean
  max: number
  initial: string[]
  confirm: (selected: string[]) => string
  save: (selected: string[]) => Promise<PlanLimitsChoiceResponse>
}

function chooserSpec(
  kind: PlanLimitsChooserKind,
  limits: PlanLimitsPage,
  date: string
): ChooserSpec | null {
  const plan = limits.planName ? `The ${limits.planName} plan` : 'Your plan'
  const grace = limits.phase === 'grace'
  const from = grace ? `From ${date}, ` : ''
  const capOf = (key: string) => limits.issues.find((issue) => issue.key === key)?.cap ?? 0
  switch (kind) {
    case 'board': {
      const boards = limits.candidates.boards ?? []
      const cap = capOf('maxBoards')
      const most = Math.max(0, ...boards.map((b) => b.postCount))
      return {
        title: 'Choose which board stays open',
        description: `${plan} includes ${plural(cap, 'board', 'boards')}. ${from}${grace ? 'the' : 'The'} others are read-only. Their posts stay visible, and you can move posts into this board.`,
        footnote: 'You can change this at any time. Every board opens again when you upgrade.',
        items: boards.map((board) => ({
          id: board.id,
          title: board.name,
          detail: plural(board.postCount, 'post', 'posts'),
          tag: most > 0 && board.postCount === most ? 'Most posts' : undefined,
        })),
        single: true,
        max: 1,
        initial: limits.keptBoardId ? [limits.keptBoardId] : [],
        confirm: (selected) => {
          const name = boards.find((b) => b.id === selected[0])?.name
          return name ? `Keep ${name} open` : 'Keep this board open'
        },
        save: (selected) => setKeptBoardFn({ data: { boardId: selected[0]! } }),
      }
    }
    case 'seats': {
      const members = limits.candidates.members ?? []
      const cap = capOf('maxTeamSeats')
      const locked = new Set(limits.lockedSeatHolderIds)
      return {
        title: 'Choose who keeps a seat',
        description: `${plan} includes ${plural(cap, 'seat', 'seats')}. ${from}${grace ? 'other' : 'Other'} teammates lose admin access until a seat frees up. Their conversations and history stay.`,
        items: members.map((member) => ({
          id: member.id,
          title: member.name ?? member.email ?? 'Teammate',
          detail: locked.has(member.id)
            ? 'Always keeps a seat'
            : member.roleNames.join(', ') || undefined,
          locked: locked.has(member.id),
        })),
        single: false,
        max: Math.max(cap, locked.size),
        initial: [...new Set([...locked, ...(limits.seatHolderIds ?? [])])],
        confirm: () => 'Save',
        save: (selected) => setSeatHoldersFn({ data: { ids: selected } }),
      }
    }
    case 'statusComponents': {
      const components = limits.candidates.statusComponents ?? []
      const cap = capOf('maxStatusComponents')
      return {
        title: 'Choose what shows on your status page',
        description: `${plan} includes ${plural(cap, 'component', 'components')}. ${from}${grace ? 'the' : 'The'} rest are hidden from your status page.`,
        items: components.map((component) => ({
          id: component.id,
          title: component.name,
          detail: component.groupName ?? undefined,
        })),
        single: false,
        max: cap,
        initial: limits.visibleStatusComponentIds ?? [],
        confirm: () => 'Save',
        save: (selected) => setVisibleStatusComponentsFn({ data: { ids: selected } }),
      }
    }
    case 'sendingDomains': {
      const domains = limits.candidates.sendingDomains ?? []
      const cap = capOf('maxSendingDomains')
      if (cap < 1) return null
      return {
        title: 'Choose which domain keeps sending',
        description: `${plan} includes ${plural(cap, 'sending domain', 'sending domains')}. ${from}${grace ? 'the' : 'The'} others pause, and email goes from your default address.`,
        items: domains.map((domain) => ({
          id: domain.id,
          title: domain.domain,
          detail: domain.status === 'verified' ? 'Verified' : 'Not verified',
        })),
        single: cap === 1,
        max: cap,
        initial: limits.sendingDomainIds ?? [],
        confirm: () => 'Save',
        save: (selected) => setKeptSendingDomainsFn({ data: { ids: selected } }),
      }
    }
  }
}

/** Whether a chooser can open: the viewer may use it and there is something to pick. */
export function chooserAvailable(kind: PlanLimitsChooserKind, limits: PlanLimitsPage): boolean {
  return limits.choosers[kind] && chooserSpec(kind, limits, '') !== null
}

/**
 * A small dialog on the Plan limits page that picks what stays: the board
 * that stays open, who keeps a seat, the status components that show, the
 * sending domain that keeps sending. Defaults come from the current choice;
 * a refusal shows inline; a save refreshes every plan limits surface.
 */
export function PlanLimitsChooserDialog(props: {
  kind: PlanLimitsChooserKind
  limits: PlanLimitsPage
  date: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const spec = chooserSpec(props.kind, props.limits, props.date)
  if (!spec) return null
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {props.open ? <ChooserBody spec={spec} onDone={() => props.onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ChooserBody(props: { spec: ChooserSpec; onDone: () => void }) {
  const { spec } = props
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>(spec.initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lockedIds = spec.items.filter((item) => item.locked).map((item) => item.id)
  const full = selected.length >= spec.max

  const toggle = (id: string, on: boolean) =>
    setSelected((current) =>
      on ? (current.includes(id) ? current : [...current, id]) : current.filter((x) => x !== id)
    )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const result = await spec.save(selected)
      if (!result.ok) {
        setError(REFUSAL_TEXT[result.reason])
        return
      }
      await queryClient.invalidateQueries({ queryKey: planLimitsQueries.all })
      props.onDone()
    } catch (err) {
      setError(errorText(err, 'Could not save this choice. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{spec.title}</DialogTitle>
        <DialogDescription>{spec.description}</DialogDescription>
      </DialogHeader>

      {spec.single ? (
        <RadioGroup
          value={selected[0] ?? ''}
          onValueChange={(value) => setSelected([String(value)])}
          className="gap-0 overflow-hidden rounded-xl border"
        >
          {spec.items.map((item) => (
            <label
              key={item.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0',
                selected[0] === item.id && 'bg-muted/50'
              )}
            >
              <RadioGroupItem value={item.id} aria-label={item.title} />
              <ChoiceText item={item} />
            </label>
          ))}
        </RadioGroup>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            {selected.length} of {spec.max} chosen
          </p>
          <ul className="overflow-hidden rounded-xl border">
            {spec.items.map((item) => {
              const checked = selected.includes(item.id)
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0"
                >
                  <Checkbox
                    checked={checked || lockedIds.includes(item.id)}
                    disabled={item.locked || (!checked && full)}
                    aria-label={item.title}
                    onCheckedChange={(on) => toggle(item.id, on === true)}
                  />
                  <ChoiceText item={item} />
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {spec.footnote ? <p className="text-[12px] text-muted-foreground">{spec.footnote}</p> : null}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={props.onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={saving || selected.length === 0}
          onClick={() => void save()}
        >
          {spec.confirm(selected)}
        </Button>
      </DialogFooter>
    </>
  )
}

function ChoiceText(props: { item: ChoiceItem }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="truncate text-[13px] font-medium">{props.item.title}</span>
        {props.item.tag ? (
          <Badge size="sm" variant="secondary">
            {props.item.tag}
          </Badge>
        ) : null}
      </span>
      {props.item.detail ? (
        <span className="block truncate text-[12px] text-muted-foreground">
          {props.item.detail}
        </span>
      ) : null}
    </span>
  )
}
