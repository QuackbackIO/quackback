import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import {
  statusComponentQueries,
  statusTemplateQueries,
  type StatusComponentsAdmin,
  type StatusIncidentTemplate,
} from '@/lib/client/queries/status'
import {
  useCreateStatusIncidentTemplate,
  useDeleteStatusIncidentTemplate,
  useUpdateStatusIncidentTemplate,
} from '@/lib/client/mutations/status'
import { IMPACT_LABELS, type StatusIncidentImpact } from './status-admin-colors'

function flattenComponents(data: StatusComponentsAdmin | undefined) {
  if (!data) return []
  const flat: Array<{ id: string; name: string }> = []
  for (const group of data.groups)
    for (const c of group.components) flat.push({ id: c.id, name: c.name })
  for (const c of data.ungrouped) flat.push({ id: c.id, name: c.name })
  return flat
}

export function StatusTemplatesView() {
  const { data: templates, isLoading } = useQuery(statusTemplateQueries.list())
  const [editing, setEditing] = useState<StatusIncidentTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StatusIncidentTemplate | null>(null)
  const deleteMutation = useDeleteStatusIncidentTemplate()

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete template')
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Templates</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon className="h-4 w-4 mr-1.5" />
          New template
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading templates…</p>
      ) : !templates || templates.length === 0 ? (
        <EmptyState
          icon={DocumentDuplicateIcon}
          title="No templates yet"
          description="Templates prefill an incident's title, body, impact, and affected components."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4 mr-1.5" />
              New template
            </Button>
          }
          className="h-48"
        />
      ) : (
        <div className="rounded-xl overflow-hidden border border-border/50 bg-card divide-y divide-border/50">
          {templates.map((t) => (
            <div key={t.id} className="group flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground truncate">{t.title}</div>
              </div>
              <span className="text-xs text-muted-foreground">{IMPACT_LABELS[t.impact]}</span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditing(t)}
                >
                  <PencilSquareIcon className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(t)}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateFormDialog open={creating} onOpenChange={setCreating} mode="create" />
      <TemplateFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        template={editing}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete template?"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

interface TemplateFormValues {
  name: string
  title: string
  body: string
  impact: StatusIncidentImpact
  componentIds: string[]
}

const EMPTY_TEMPLATE: TemplateFormValues = {
  name: '',
  title: '',
  body: '',
  impact: 'minor',
  componentIds: [],
}

function TemplateFormDialog({
  open,
  onOpenChange,
  mode,
  template,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  template?: StatusIncidentTemplate | null
}) {
  const [values, setValues] = useState<TemplateFormValues>(EMPTY_TEMPLATE)
  const { data: componentsData } = useQuery(statusComponentQueries.list())
  const components = useMemo(() => flattenComponents(componentsData), [componentsData])
  const createMutation = useCreateStatusIncidentTemplate()
  const updateMutation = useUpdateStatusIncidentTemplate()
  const isPending = createMutation.isPending || updateMutation.isPending

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && template) {
      setValues({
        name: template.name,
        title: template.title,
        body: template.body,
        impact: template.impact,
        componentIds: template.componentIds,
      })
    } else {
      setValues(EMPTY_TEMPLATE)
    }
  }, [open, mode, template])

  function toggleComponent(id: string) {
    setValues((v) => ({
      ...v,
      componentIds: v.componentIds.includes(id)
        ? v.componentIds.filter((c) => c !== id)
        : [...v.componentIds, id],
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!values.name.trim() || !values.title.trim() || !values.body.trim()) return
    try {
      if (mode === 'edit' && template) {
        await updateMutation.mutateAsync({
          id: template.id,
          name: values.name.trim(),
          title: values.title.trim(),
          body: values.body.trim(),
          impact: values.impact,
          componentIds: values.componentIds,
        })
      } else {
        await createMutation.mutateAsync({
          name: values.name.trim(),
          title: values.title.trim(),
          body: values.body.trim(),
          impact: values.impact,
          componentIds: values.componentIds,
        })
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save template')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit template' : 'New template'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Template name</Label>
            <Input
              id="template-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g., API degradation"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-title">Incident title</Label>
            <Input
              id="template-title"
              value={values.title}
              onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-body">Body</Label>
            <Textarea
              id="template-body"
              value={values.body}
              onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
              className="min-h-24"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Impact</Label>
            <Select
              value={values.impact}
              onValueChange={(v) =>
                setValues((val) => ({ ...val, impact: v as StatusIncidentImpact }))
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minor">{IMPACT_LABELS.minor}</SelectItem>
                <SelectItem value="major">{IMPACT_LABELS.major}</SelectItem>
                <SelectItem value="critical">{IMPACT_LABELS.critical}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default affected components</Label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50">
              {components.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 border-b border-border/40 px-3 py-2 last:border-b-0"
                >
                  <Checkbox
                    checked={values.componentIds.includes(c.id)}
                    onCheckedChange={() => toggleComponent(c.id)}
                  />
                  <span className="text-sm">{c.name}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !values.name.trim() || !values.title.trim() || !values.body.trim() || isPending
              }
            >
              {isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
