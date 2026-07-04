/**
 * Workflows manager (AI & Automation, support platform §4.6). Lists workflows
 * with their trigger + class + lifecycle, and a functional editor: the trigger,
 * class, and the graph as JSON (the server validates it via the shared schema).
 * The auto-layout canvas is the fast-follow; this is the form-based v0 the engine
 * is already live behind.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { WorkflowDTO } from '@/lib/server/functions/workflows'
import { workflowsQuery } from '@/lib/client/queries/workflows'
import {
  useCreateWorkflow,
  useUpdateWorkflow,
  useSetWorkflowStatus,
  useDeleteWorkflow,
} from '@/lib/client/mutations/workflows'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const CLASSES = [
  { value: 'customer_facing', label: 'Customer-facing (exclusive)' },
  { value: 'background', label: 'Background (parallel)' },
] as const

const TRIGGERS = [
  { value: 'conversation.created', label: 'New conversation' },
  { value: 'message.created', label: 'Message received' },
  { value: 'conversation.status_changed', label: 'Status changed' },
  { value: 'conversation.assigned', label: 'Assigned to team/agent' },
] as const

const STATUSES = ['draft', 'live', 'paused'] as const

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  live: 'default',
  paused: 'secondary',
  draft: 'outline',
}

const EMPTY_GRAPH = JSON.stringify({ nodes: [{ id: 't', type: 'trigger' }], edges: [] }, null, 2)

const triggerLabel = (v: string) => TRIGGERS.find((t) => t.value === v)?.label ?? v

export function WorkflowsManager() {
  const { data: workflows } = useQuery(workflowsQuery())
  const [editing, setEditing] = useState<WorkflowDTO | 'new' | null>(null)
  const setStatus = useSetWorkflowStatus()
  const del = useDeleteWorkflow()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Workflows</h2>
          <p className="text-sm text-muted-foreground">
            Automate routing, SLAs, and replies from a trigger.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <PlusIcon className="mr-1.5 size-4" />
          New workflow
        </Button>
      </div>

      {workflows && workflows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No workflows yet. Create one to start automating.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {(workflows ?? []).map((wf) => (
            <li key={wf.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{wf.name}</span>
                  <Badge variant={STATUS_VARIANT[wf.status] ?? 'outline'}>{wf.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {triggerLabel(wf.triggerType)} &middot;{' '}
                  {wf.class === 'customer_facing' ? 'Customer-facing' : 'Background'}
                </div>
              </div>
              <Select
                value={wf.status}
                onValueChange={(status) =>
                  setStatus.mutate(
                    { id: wf.id, status: status as (typeof STATUSES)[number] },
                    { onError: () => toast.error('Could not update status') }
                  )
                }
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setEditing(wf)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete workflow"
                onClick={() =>
                  del.mutate(wf.id, { onError: () => toast.error('Could not delete workflow') })
                }
              >
                <TrashIcon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <WorkflowEditor
          workflow={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function WorkflowEditor({
  workflow,
  onClose,
}: {
  workflow: WorkflowDTO | null
  onClose: () => void
}) {
  const create = useCreateWorkflow()
  const update = useUpdateWorkflow()
  const [name, setName] = useState(workflow?.name ?? '')
  const [cls, setCls] = useState<(typeof CLASSES)[number]['value']>(
    (workflow?.class as (typeof CLASSES)[number]['value']) ?? 'background'
  )
  const [triggerType, setTriggerType] = useState(workflow?.triggerType ?? TRIGGERS[0].value)
  const [graphText, setGraphText] = useState(
    workflow ? JSON.stringify(workflow.graph, null, 2) : EMPTY_GRAPH
  )
  const [graphError, setGraphError] = useState<string | null>(null)
  const saving = create.isPending || update.isPending

  const save = () => {
    let graph: unknown
    try {
      graph = JSON.parse(graphText)
    } catch {
      setGraphError('The graph is not valid JSON.')
      return
    }
    setGraphError(null)
    const onError = () => toast.error('The workflow could not be saved. Check the graph.')
    if (workflow) {
      update.mutate(
        { id: workflow.id, name, class: cls, triggerType, graph: graph as never },
        { onSuccess: onClose, onError }
      )
    } else {
      create.mutate(
        { name, class: cls, triggerType, graph: graph as never },
        { onSuccess: onClose, onError }
      )
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{workflow ? 'Edit workflow' : 'New workflow'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">Name</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Route billing to Finance"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={cls} onValueChange={(v) => setCls(v as typeof cls)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASSES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-graph">Graph</Label>
            <Textarea
              id="wf-graph"
              value={graphText}
              onChange={(e) => setGraphText(e.target.value)}
              className="h-48 font-mono text-xs"
              spellCheck={false}
            />
            {graphError && <p className="text-xs text-destructive">{graphError}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {workflow ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
