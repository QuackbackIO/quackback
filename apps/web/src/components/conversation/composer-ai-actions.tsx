import { useEffect, useRef, useState } from 'react'
import { ArrowPathIcon, ChevronDownIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCopilotTabGate } from '@/lib/client/hooks/use-copilot-tab-gate'
import { useCopilotTransform } from '@/lib/client/hooks/use-copilot-transform'
import type { TransformKind } from '@/lib/shared/assistant/copilot-contract'
import type { InboxItemRef } from '@/lib/shared/inbox/items'

export type ComposerMode = 'reply' | 'note'

const IMPROVE_GROUPS: ReadonlyArray<{
  label: string
  rows: ReadonlyArray<{ transform: TransformKind; label: string }>
}> = [
  {
    label: 'Rewrite',
    rows: [
      { transform: 'rephrase', label: 'Rephrase' },
      { transform: 'fix_grammar', label: 'Fix grammar and spelling' },
    ],
  },
  {
    label: 'Tone',
    rows: [
      { transform: 'more_friendly', label: 'More friendly' },
      { transform: 'more_formal', label: 'More formal' },
    ],
  },
  {
    label: 'Length',
    rows: [
      { transform: 'more_concise', label: 'More concise' },
      { transform: 'expand', label: 'Expand' },
    ],
  },
]

interface ReplacementState {
  mode: ComposerMode
  result: string
}

interface UndoState extends ReplacementState {
  restore: () => void
}

export function ComposerAiActions({
  item,
  activeMode,
  activeDraftText,
  getDraftText,
  onReplaceDraftText,
}: {
  item: InboxItemRef
  activeMode: ComposerMode
  activeDraftText: string
  getDraftText: (mode: ComposerMode) => string
  /** Replace one mode's whole draft and return a full-fidelity restore action. */
  onReplaceDraftText: (mode: ComposerMode, text: string) => () => void
}) {
  const available = useCopilotTabGate()
  const runTransform = useCopilotTransform(item)
  const activeModeRef = useRef(activeMode)
  activeModeRef.current = activeMode
  const [transforming, setTransforming] = useState(false)
  const [proposal, setProposal] = useState<ReplacementState | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)

  // Keep Undo until the transformed draft is deliberately edited again.
  useEffect(() => {
    if (undo && getDraftText(undo.mode) !== undo.result) setUndo(null)
  }, [activeMode, activeDraftText, getDraftText, undo])

  if (!available) return null

  const applyResult = (mode: ComposerMode, result: string) => {
    const restore = onReplaceDraftText(mode, result)
    setProposal(null)
    setUndo({ mode, result, restore })
  }

  const improve = async (transform: TransformKind) => {
    const mode = activeMode
    const source = getDraftText(mode)
    if (transforming || !source.trim()) return
    setTransforming(true)
    setProposal(null)
    try {
      const result = await runTransform(transform, source)
      if (!result) return

      // Never overwrite work typed while the request was running, or a draft
      // that has since become hidden behind the other composer mode.
      if (getDraftText(mode) !== source || activeModeRef.current !== mode) {
        setProposal({ mode, result })
      } else {
        applyResult(mode, result)
      }
    } finally {
      setTransforming(false)
    }
  }

  const visibleProposal = proposal?.mode === activeMode ? proposal : null
  const visibleUndo = undo?.mode === activeMode ? undo : null

  return (
    <>
      {visibleProposal && (
        <div
          role="status"
          className="order-first mb-1 flex w-full flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[13px]"
        >
          <span className="min-w-48 flex-1 text-muted-foreground">
            Your {activeMode} draft changed while Improve was working.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            shape="default"
            onClick={() => applyResult(visibleProposal.mode, visibleProposal.result)}
          >
            Use improved draft
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            shape="default"
            onClick={() => setProposal(null)}
          >
            Keep current
          </Button>
        </div>
      )}
      {visibleUndo && !visibleProposal && (
        <div
          role="status"
          className="order-first mb-1 flex w-full items-center gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-[13px] text-muted-foreground"
        >
          <span className="flex-1">Draft improved.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            shape="default"
            onClick={() => {
              visibleUndo.restore()
              setUndo(null)
            }}
          >
            Undo
          </Button>
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            shape="default"
            disabled={transforming || !activeDraftText.trim()}
            title={!activeDraftText.trim() ? 'Write a draft first' : undefined}
          >
            {transforming ? (
              <ArrowPathIcon className="size-4 animate-spin" />
            ) : (
              <SparklesIcon className="size-4" />
            )}
            {transforming ? 'Improving…' : 'Improve'}
            {!transforming && <ChevronDownIcon className="size-3.5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {IMPROVE_GROUPS.map((group, index) => (
            <div key={group.label}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.rows.map((row) => (
                <DropdownMenuItem key={row.transform} onClick={() => void improve(row.transform)}>
                  {row.label}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
