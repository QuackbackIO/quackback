/**
 * The step palette: shown in the inspector when a "+" connector is active
 * instead of a step. A search box filters by label; groups are SEND and
 * COLLECT (the 8 conversational block kinds, Phase C slice C-5) above the
 * pre-existing Logic (condition/branch/wait) and Actions (all 9 action
 * types) groups, per the design brief's §4/§5.12 — each icon tinted by the
 * same tone the canvas card for that step kind uses. Clicking an item
 * inserts that step at the active insertion point and selects it.
 */
import { useState, type ComponentType } from 'react'
import { ClockIcon, FunnelIcon, MagnifyingGlassIcon, ShareIcon } from '@heroicons/react/24/outline'
import { ACTION_ICONS, BLOCK_ICONS, TONE_TILE } from '../step-visuals'
import { ACTION_TONE, type Tone } from '../flow-layout'
import {
  ACTION_LABELS,
  ACTION_TYPES,
  BLOCK_STEP_LABELS,
  COLLECT_BLOCK_KINDS,
  SEND_BLOCK_KINDS,
  type ActionType,
  type BlockStepKind,
  type TreeStep,
} from '../../workflow-graph'

interface PaletteItem {
  label: string
  icon: ComponentType<{ className?: string }>
  tone: Tone
  onSelect: () => void
}

export function StepPalette({
  onInsert,
}: {
  onInsert: (kind: TreeStep['kind'], actionType?: ActionType) => void
}) {
  const [query, setQuery] = useState('')

  const blockItem = (kind: BlockStepKind): PaletteItem => ({
    label: BLOCK_STEP_LABELS[kind],
    icon: BLOCK_ICONS[kind],
    tone: 'pink',
    onSelect: () => onInsert(kind),
  })
  const send: PaletteItem[] = SEND_BLOCK_KINDS.map(blockItem)
  const collect: PaletteItem[] = COLLECT_BLOCK_KINDS.map(blockItem)
  const logic: PaletteItem[] = [
    { label: 'Condition', icon: FunnelIcon, tone: 'violet', onSelect: () => onInsert('condition') },
    {
      label: 'Branch into paths',
      icon: ShareIcon,
      tone: 'violet',
      onSelect: () => onInsert('branch'),
    },
    { label: 'Wait', icon: ClockIcon, tone: 'amber', onSelect: () => onInsert('wait') },
  ]
  const actions: PaletteItem[] = ACTION_TYPES.map((type) => ({
    label: ACTION_LABELS[type],
    icon: ACTION_ICONS[type],
    tone: ACTION_TONE[type],
    onSelect: () => onInsert('action', type),
  }))

  const q = query.trim().toLowerCase()
  const matches = (item: PaletteItem) => !q || item.label.toLowerCase().includes(q)
  const groups = [
    { label: 'Send', items: send.filter(matches) },
    { label: 'Collect', items: collect.filter(matches) },
    { label: 'Logic', items: logic.filter(matches) },
    { label: 'Actions', items: actions.filter(matches) },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search steps…"
          aria-label="Search steps"
          className="w-full rounded-md border border-input bg-secondary py-1.5 pr-2.5 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      {groups.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No steps match "{query}".</p>
      ) : (
        groups.map((group) => (
          <PaletteGroup key={group.label} label={group.label} items={group.items} />
        ))
      )}
    </div>
  )
}

function PaletteGroup({ label, items }: { label: string; items: PaletteItem[] }) {
  return (
    <div>
      <div className="mb-1 px-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onSelect}
            className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-muted/60"
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-md ${TONE_TILE[item.tone]}`}
            >
              <item.icon className="size-3.5" />
            </span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
