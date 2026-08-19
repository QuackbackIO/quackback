/** JSON mode: the graph textarea that replaces the canvas when the top bar's
 *  Visual/JSON toggle is on JSON. Parse/validate-on-toggle-back behavior is
 *  owned by useWorkflowBuilder.setEditorMode; this just edits the text. */
import { Textarea } from '@/components/ui/textarea'
import type { GraphDraft } from '../workflow-graph'

export function JsonPanel({
  draft,
  onChange,
  error,
}: {
  draft: Extract<GraphDraft, { mode: 'json' }>
  onChange: (draft: GraphDraft) => void
  error?: string | null
}) {
  return (
    <div className="flex-1 space-y-1.5 overflow-auto bg-muted/10 p-4">
      {draft.notice && <p className="text-xs text-amber-600 dark:text-amber-500">{draft.notice}</p>}
      <Textarea
        value={draft.text}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        className="min-h-[60vh] font-mono text-xs"
        spellCheck={false}
        aria-label="Workflow graph JSON"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
