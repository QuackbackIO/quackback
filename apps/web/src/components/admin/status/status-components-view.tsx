import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Bars3Icon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { StatusSelect } from '@/components/shared/sidebar-primitives'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import {
  statusComponentQueries,
  type StatusComponentAdmin,
  type StatusComponentGroupAdmin,
} from '@/lib/client/queries/status'
import {
  useCreateStatusComponent,
  useCreateStatusGroup,
  useDeleteStatusComponent,
  useDeleteStatusGroup,
  useReorderStatusComponents,
  useReorderStatusGroups,
  useSetStatusComponentStatus,
  useUpdateStatusComponent,
} from '@/lib/client/mutations/status'
import {
  COMPONENT_STATUS_COLORS,
  COMPONENT_STATUS_OPTIONS,
  type StatusComponentStatus,
} from './status-admin-colors'
import type { StatusUptimeDay } from '@/lib/client/queries/status'

interface ComponentFormValues {
  name: string
  description: string
  groupId: string | null
  showUptime: boolean
  segmentIds: string[]
}

const EMPTY_FORM: ComponentFormValues = {
  name: '',
  description: '',
  groupId: null,
  showUptime: true,
  segmentIds: [],
}

export function StatusComponentsView() {
  const { data, isLoading } = useQuery(statusComponentQueries.list())
  const [groups, setGroups] = useState<StatusComponentGroupAdmin[]>([])
  const [ungrouped, setUngrouped] = useState<StatusComponentAdmin[]>([])
  const [search, setSearch] = useState('')

  // One uptime fetch for every service with a bar; rows look their series
  // up by id. 90 days to match the public page's window.
  const uptimeIds = [...ungrouped, ...groups.flatMap((g) => g.components)]
    .filter((c) => c.showUptime)
    .map((c) => c.id)
  const uptimeQuery = useQuery(statusComponentQueries.uptimeAdmin(uptimeIds))
  const uptimeById = new Map((uptimeQuery.data ?? []).map((s) => [s.componentId, s.days]))

  const term = search.trim().toLowerCase()
  const matches = (c: StatusComponentAdmin) =>
    term === '' ||
    c.name.toLowerCase().includes(term) ||
    (c.description ?? '').toLowerCase().includes(term)
  const visibleUngrouped = ungrouped.filter(matches)
  const visibleGroups = groups
    .map((g) => ({ ...g, components: g.components.filter(matches) }))
    .filter((g) => term === '' || g.components.length > 0 || g.name.toLowerCase().includes(term))
  // Reordering a filtered subset would rewrite positions for only the
  // visible ids, so drag is disabled while searching.
  const dragDisabled = term !== ''

  useEffect(() => {
    if (data) {
      setGroups(data.groups)
      setUngrouped(data.ungrouped)
    }
  }, [data])

  const reorderComponents = useReorderStatusComponents()
  const reorderGroups = useReorderStatusGroups()
  const setStatusMutation = useSetStatusComponentStatus()
  const updateComponentMutation = useUpdateStatusComponent()
  const deleteComponentMutation = useDeleteStatusComponent()
  const deleteGroupMutation = useDeleteStatusGroup()

  const [editingComponent, setEditingComponent] = useState<StatusComponentAdmin | null>(null)
  const [createGroupId, setCreateGroupId] = useState<string | null | undefined>(undefined)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [deleteComponent, setDeleteComponent] = useState<StatusComponentAdmin | null>(null)
  const [deleteGroup, setDeleteGroup] = useState<StatusComponentGroupAdmin | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (dragDisabled) return
    if (!over || active.id === over.id) return

    // Groups themselves can be reordered when the dragged id matches a group.
    const groupIndex = groups.findIndex((g) => g.id === active.id)
    if (groupIndex !== -1) {
      const overIndex = groups.findIndex((g) => g.id === over.id)
      if (overIndex === -1) return
      const reordered = arrayMove(groups, groupIndex, overIndex)
      setGroups(reordered)
      try {
        await reorderGroups.mutateAsync(reordered.map((g) => g.id))
      } catch {
        toast.error('Failed to reorder groups')
        if (data) setGroups(data.groups)
      }
      return
    }

    // Otherwise it's a component — find which section (group or ungrouped) it lives in.
    const ungroupedIndex = ungrouped.findIndex((c) => c.id === active.id)
    if (ungroupedIndex !== -1) {
      const overIndex = ungrouped.findIndex((c) => c.id === over.id)
      if (overIndex === -1) return
      const reordered = arrayMove(ungrouped, ungroupedIndex, overIndex)
      setUngrouped(reordered)
      try {
        await reorderComponents.mutateAsync(reordered.map((c) => c.id))
      } catch {
        toast.error('Failed to reorder services')
        if (data) setUngrouped(data.ungrouped)
      }
      return
    }

    for (const group of groups) {
      const idx = group.components.findIndex((c) => c.id === active.id)
      if (idx === -1) continue
      const overIndex = group.components.findIndex((c) => c.id === over.id)
      if (overIndex === -1) return
      const reorderedComponents = arrayMove(group.components, idx, overIndex)
      setGroups((prev) =>
        prev.map((g) => (g.id === group.id ? { ...g, components: reorderedComponents } : g))
      )
      try {
        await reorderComponents.mutateAsync(reorderedComponents.map((c) => c.id))
      } catch {
        toast.error('Failed to reorder services')
        if (data) setGroups(data.groups)
      }
      return
    }
  }

  async function handleStatusChange(componentId: string, status: StatusComponentStatus) {
    try {
      await setStatusMutation.mutateAsync({ id: componentId, status })
    } catch {
      toast.error('Failed to update status')
    }
  }

  async function handleUptimeToggle(component: StatusComponentAdmin, checked: boolean) {
    try {
      await updateComponentMutation.mutateAsync({ id: component.id, showUptime: checked })
    } catch {
      toast.error('Failed to update service')
    }
  }

  async function confirmDeleteComponent() {
    if (!deleteComponent) return
    try {
      await deleteComponentMutation.mutateAsync(deleteComponent.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete service')
    } finally {
      setDeleteComponent(null)
    }
  }

  async function confirmDeleteGroup() {
    if (!deleteGroup) return
    try {
      await deleteGroupMutation.mutateAsync(deleteGroup.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete group')
    } finally {
      setDeleteGroup(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto w-full flex flex-col flex-1 min-h-0">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2 border-b border-border/40">
        <h2 className="text-sm font-semibold px-1">Services</h2>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services…"
          className="h-8 w-48 text-sm bg-muted/30 border-border/50"
        />
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => setCreateGroupDialogOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            New group
          </Button>
          <Button size="sm" onClick={() => setCreateGroupId(null)}>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            New service
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/50 bg-card p-4 flex items-center gap-3"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24 ml-auto" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3 space-y-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <div className="rounded-xl overflow-hidden border border-border/50 bg-card shadow-sm divide-y divide-border/50">
              <SortableContext
                items={visibleUngrouped.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {visibleUngrouped.map((component) => (
                  <SortableComponentRow
                    key={component.id}
                    component={component}
                    uptimeDays={uptimeById.get(component.id)}
                    dragDisabled={dragDisabled}
                    onStatusChange={handleStatusChange}
                    onUptimeToggle={handleUptimeToggle}
                    onEdit={() => setEditingComponent(component)}
                    onDelete={() => setDeleteComponent(component)}
                  />
                ))}
              </SortableContext>

              <SortableContext
                items={visibleGroups.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                {visibleGroups.map((group) => (
                  <div key={group.id}>
                    <SortableGroupHeader
                      group={group}
                      onDelete={() => setDeleteGroup(group)}
                      onAddComponent={() => setCreateGroupId(group.id)}
                    />
                    <SortableContext
                      items={group.components.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {group.components.map((component) => (
                        <SortableComponentRow
                          key={component.id}
                          component={component}
                          indent
                          uptimeDays={uptimeById.get(component.id)}
                          dragDisabled={dragDisabled}
                          onStatusChange={handleStatusChange}
                          onUptimeToggle={handleUptimeToggle}
                          onEdit={() => setEditingComponent(component)}
                          onDelete={() => setDeleteComponent(component)}
                        />
                      ))}
                    </SortableContext>
                  </div>
                ))}
              </SortableContext>
            </div>
          </DndContext>

          {groups.length === 0 && ungrouped.length === 0 && (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm font-medium text-foreground">Add a service</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Track a service so you can publish incidents, maintenance, and uptime.
              </p>
              <Button size="sm" onClick={() => setCreateGroupId(null)}>
                Add service
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground max-w-2xl">
            Changing a service&apos;s status here updates the public page and uptime history. It
            never emails subscribers; only publishing a new incident or scheduling maintenance does.
          </p>

          <ComponentFormDialog
            open={createGroupId !== undefined}
            onOpenChange={(o) => !o && setCreateGroupId(undefined)}
            mode="create"
            groups={groups}
            defaultGroupId={createGroupId ?? null}
          />

          <ComponentFormDialog
            open={!!editingComponent}
            onOpenChange={(o) => !o && setEditingComponent(null)}
            mode="edit"
            groups={groups}
            component={editingComponent}
          />

          <CreateGroupDialog open={createGroupDialogOpen} onOpenChange={setCreateGroupDialogOpen} />

          <ConfirmDialog
            open={!!deleteComponent}
            onOpenChange={(o) => !o && setDeleteComponent(null)}
            title="Delete service?"
            description={`Are you sure you want to delete "${deleteComponent?.name}"? This cannot be undone.`}
            confirmLabel="Delete"
            variant="destructive"
            isPending={deleteComponentMutation.isPending}
            onConfirm={confirmDeleteComponent}
          />

          <ConfirmDialog
            open={!!deleteGroup}
            onOpenChange={(o) => !o && setDeleteGroup(null)}
            title="Delete group?"
            description={`Are you sure you want to delete "${deleteGroup?.name}"? Components in this group will become ungrouped.`}
            confirmLabel="Delete"
            variant="destructive"
            isPending={deleteGroupMutation.isPending}
            onConfirm={confirmDeleteGroup}
          />
        </div>
      )}
    </div>
  )
}

function SortableGroupHeader({
  group,
  onDelete,
  onAddComponent,
}: {
  group: StatusComponentGroupAdmin
  onDelete: () => void
  onAddComponent: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 bg-muted/40 px-3 py-2"
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing"
      >
        <Bars3Icon className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>
      <span className="text-sm font-semibold">{group.name}</span>
      <Badge variant="outline" className="h-5">
        Group
      </Badge>
      <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onAddComponent}
          title="Add service"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          title="Delete group"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

/** Compact 90-day uptime readout: the same data the public page renders,
 *  trimmed to the last 45 day-bars plus the window average. */
function UptimeStrip({ days }: { days: StatusUptimeDay[] }) {
  const shown = days.slice(-45)
  const avg = days.length > 0 ? days.reduce((sum, d) => sum + d.uptimePct, 0) / days.length : 100
  return (
    <div
      className="hidden md:flex items-center gap-1.5 shrink-0"
      title={`${avg.toFixed(2)}% uptime over ${days.length} days`}
    >
      <div className="flex items-end gap-px h-3.5">
        {shown.map((d) => (
          <span
            key={d.date}
            className="w-[3px] rounded-[1px] h-full"
            style={{ backgroundColor: COMPONENT_STATUS_COLORS[d.worstStatus] }}
          />
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{avg.toFixed(2)}%</span>
    </div>
  )
}

function SortableComponentRow({
  component,
  indent,
  uptimeDays,
  dragDisabled,
  onStatusChange,
  onUptimeToggle,
  onEdit,
  onDelete,
}: {
  component: StatusComponentAdmin
  indent?: boolean
  uptimeDays?: StatusUptimeDay[]
  dragDisabled?: boolean
  onStatusChange: (id: string, status: StatusComponentStatus) => void
  onUptimeToggle: (component: StatusComponentAdmin, checked: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: component.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 px-3 py-2.5 ${indent ? 'pl-8' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        disabled={dragDisabled}
        className="touch-none cursor-grab active:cursor-grabbing disabled:invisible"
      >
        <Bars3Icon className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{component.name}</span>
          {component.segmentIds.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 px-2 py-0.5 text-[11px] font-medium">
              <UsersIcon className="h-2.5 w-2.5" />
              {component.segmentIds.length} segment{component.segmentIds.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {component.description && (
          <p className="text-xs text-muted-foreground truncate">{component.description}</p>
        )}
      </div>

      {component.showUptime && uptimeDays && uptimeDays.length > 0 && (
        <UptimeStrip days={uptimeDays} />
      )}

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <Switch
          checked={component.showUptime}
          onCheckedChange={(c) => onUptimeToggle(component, c)}
        />
        <span>Uptime bar</span>
      </div>

      <StatusSelect
        value={component.status}
        options={COMPONENT_STATUS_OPTIONS}
        onChange={(v) => onStatusChange(component.id, v as StatusComponentStatus)}
      />

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          title="Edit service"
        >
          <PencilSquareIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          title="Delete service"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const createGroup = useCreateStatusGroup()

  useEffect(() => {
    if (open) setName('')
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await createGroup.mutateAsync({ name: name.trim() })
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create group')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            Groups organize related services on the status page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Infrastructure"
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || createGroup.isPending}>
              {createGroup.isPending ? 'Creating…' : 'Create group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ComponentFormDialog({
  open,
  onOpenChange,
  mode,
  groups,
  component,
  defaultGroupId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  groups: StatusComponentGroupAdmin[]
  component?: StatusComponentAdmin | null
  defaultGroupId?: string | null
}) {
  const [values, setValues] = useState<ComponentFormValues>(EMPTY_FORM)
  const segmentsQuery = useSegments()
  const createComponent = useCreateStatusComponent()
  const updateComponent = useUpdateStatusComponent()
  const isPending = createComponent.isPending || updateComponent.isPending

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && component) {
      setValues({
        name: component.name,
        description: component.description ?? '',
        groupId: component.groupId,
        showUptime: component.showUptime,
        segmentIds: component.segmentIds,
      })
    } else {
      setValues({ ...EMPTY_FORM, groupId: defaultGroupId ?? null })
    }
  }, [open, mode, component, defaultGroupId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!values.name.trim()) return
    try {
      if (mode === 'edit' && component) {
        await updateComponent.mutateAsync({
          id: component.id,
          name: values.name.trim(),
          description: values.description.trim() || null,
          groupId: values.groupId,
          showUptime: values.showUptime,
          segmentIds: values.segmentIds,
        })
      } else {
        await createComponent.mutateAsync({
          name: values.name.trim(),
          description: values.description.trim() || null,
          groupId: values.groupId,
          showUptime: values.showUptime,
          segmentIds: values.segmentIds,
        })
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save service')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit service' : 'New service'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="component-name">Name</Label>
            <Input
              id="component-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g., API"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="component-description">Description</Label>
            <Textarea
              id="component-description"
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              placeholder="Optional — shown as a tooltip on the public page"
            />
          </div>

          <div className="space-y-2">
            <Label>Group</Label>
            <Select
              value={values.groupId ?? '__none__'}
              onValueChange={(v) =>
                setValues((val) => ({ ...val, groupId: v === '__none__' ? null : v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No group</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label>Show uptime bar</Label>
            <Switch
              checked={values.showUptime}
              onCheckedChange={(c) => setValues((v) => ({ ...v, showUptime: c }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Restrict to segments</Label>
            <p className="text-xs text-muted-foreground">
              Leave empty to show this service to everyone who can view the status page.
            </p>
            {segmentsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading segments…</p>
            ) : (
              <SegmentMultiSelect
                segments={segmentsQuery.data ?? []}
                value={values.segmentIds}
                onChange={(next) => setValues((v) => ({ ...v, segmentIds: next }))}
              />
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!values.name.trim() || isPending}>
              {isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create service'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
