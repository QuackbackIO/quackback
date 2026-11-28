import { COMPOSER_WORDS } from '@/components/admin/conversation/inbox-labels'
import { type MessageDescriptor } from 'react-intl'
import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  label: MessageDescriptor
  rows: ReadonlyArray<{ transform: TransformKind; label: MessageDescriptor }>
}> = [
  {
    label: { id: 'admin.inbox.composerAiActions.rewrite', defaultMessage: 'Rewrite' },
    rows: [
      {
        transform: 'rephrase',
        label: { id: 'admin.inbox.composerAiActions.rephrase', defaultMessage: 'Rephrase' },
      },
      {
        transform: 'fix_grammar',
        label: {
          id: 'admin.inbox.composerAiActions.fixGrammarAndSpelling',
          defaultMessage: 'Fix grammar and spelling',
        },
      },
    ],
  },
  {
    label: { id: 'admin.inbox.composerAiActions.tone', defaultMessage: 'Tone' },
    rows: [
      {
        transform: 'more_friendly',
        label: {
          id: 'admin.inbox.composerAiActions.moreFriendly',
          defaultMessage: 'More friendly',
        },
      },
      {
        transform: 'more_formal',
        label: { id: 'admin.inbox.composerAiActions.moreFormal', defaultMessage: 'More formal' },
      },
    ],
  },
  {
    label: { id: 'admin.inbox.composerAiActions.length', defaultMessage: 'Length' },
    rows: [
      {
        transform: 'more_concise',
        label: { id: 'admin.inbox.composerAiActions.moreConcise', defaultMessage: 'More concise' },
      },
      {
        transform: 'expand',
        label: { id: 'admin.inbox.composerAiActions.expand', defaultMessage: 'Expand' },
      },
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

export const ComposerAiActions = memo(function ComposerAiActions({
  item,
  activeMode,
  subscribeDraft,
  getDraftText,
  onReplaceDraftText,
}: {
  item: InboxItemRef
  activeMode: ComposerMode
  /** Calls back on every draft change; returns the unsubscribe. */
  subscribeDraft: (onChange: () => void) => () => void
  getDraftText: (mode: ComposerMode) => string
  /** Replace one mode's whole draft and return a full-fidelity restore action. */
  onReplaceDraftText: (mode: ComposerMode, text: string) => () => void
}) {
  const intl = useOptionalIntl()
  const available = useCopilotTabGate()
  const runTransform = useCopilotTransform(item)
  const activeModeRef = useRef(activeMode)
  activeModeRef.current = activeMode
  const [transforming, setTransforming] = useState(false)
  const [proposal, setProposal] = useState<ReplacementState | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)
  // Re-renders only when the active draft gains or loses text, not per keystroke.
  const hasDraftText = useSyncExternalStore(
    subscribeDraft,
    () => getDraftText(activeMode).trim() !== '',
    () => false
  )

  // Keep Undo until the transformed draft is deliberately edited again.
  useEffect(() => {
    if (!undo) return
    const dropIfEdited = () => {
      if (getDraftText(undo.mode) !== undo.result) setUndo(null)
    }
    dropIfEdited()
    return subscribeDraft(dropIfEdited)
  }, [activeMode, getDraftText, subscribeDraft, undo])

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
            {intl.formatMessage(
              {
                id: 'admin.inbox.composerAiActions.draftChanged',
                defaultMessage:
                  '{mode, select, note {Your note draft changed while Improve was working.} other {Your reply draft changed while Improve was working.}}',
              },
              { mode: activeMode }
            )}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => applyResult(visibleProposal.mode, visibleProposal.result)}
          >
            {intl.formatMessage({
              id: 'admin.inbox.composerAiActions.useImprovedDraft',
              defaultMessage: 'Use improved draft',
            })}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setProposal(null)}>
            {intl.formatMessage({
              id: 'admin.inbox.composerAiActions.keepCurrent',
              defaultMessage: 'Keep current',
            })}
          </Button>
        </div>
      )}
      {visibleUndo && !visibleProposal && (
        <div
          role="status"
          className="order-first mb-1 flex w-full items-center gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-[13px] text-muted-foreground"
        >
          <span className="flex-1">
            {intl.formatMessage({
              id: 'admin.inbox.composerAiActions.draftImproved',
              defaultMessage: 'Draft improved.',
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              visibleUndo.restore()
              setUndo(null)
            }}
          >
            {intl.formatMessage({
              id: 'admin.inbox.composerAiActions.undo',
              defaultMessage: 'Undo',
            })}
          </Button>
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={transforming || !hasDraftText}
            title={
              !hasDraftText
                ? intl.formatMessage({
                    id: 'admin.inbox.composerAiActions.writeDraftFirst',
                    defaultMessage: 'Write a draft first',
                  })
                : undefined
            }
          >
            {transforming ? (
              <ArrowPathIcon className="size-4 animate-spin" />
            ) : (
              <SparklesIcon className="size-4" />
            )}
            {intl.formatMessage(transforming ? COMPOSER_WORDS.improving : COMPOSER_WORDS.improve)}
            {!transforming && <ChevronDownIcon className="size-3.5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {IMPROVE_GROUPS.map((group, index) => (
            <div key={group.label.id}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{intl.formatMessage(group.label)}</DropdownMenuLabel>
              {group.rows.map((row) => (
                <DropdownMenuItem key={row.transform} onClick={() => void improve(row.transform)}>
                  {intl.formatMessage(row.label)}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
})
