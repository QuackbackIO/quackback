import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
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
  EllipsisHorizontalIcon,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

  /** The service row being dragged (null for group drags). Also blocks the
   *  sync-from-server effect so a mid-drag refetch can't clobber the
   *  in-flight container moves. */
  const [activeDrag, setActiveDrag] = useState<StatusComponentAdmin | null>(null)
  const commitInFlight = useRef(false)

  useEffect(() => {
    if (data && !activeDrag && !commitInFlight.current) {
      setGroups(data.groups)
      setUngrouped(data.ungrouped)
    }
  }, [data, activeDrag])

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

  const UNGROUPED = '__ungrouped__'

  /** Container holding a component id: UNGROUPED, a group id, or null. */
  function findContainerOf(componentId: string): string | null {
    if (ungrouped.some((c) => c.id === componentId)) return UNGROUPED
    return groups.find((g) => g.components.some((c) => c.id === componentId))?.id ?? null
  }

  /** A droppable target can be a component id, a group id (its header row,
   *  which doubles as the drop target for empty groups), or the ungrouped
   *  drop zone. Resolve any of them to a container id. */
  function resolveContainer(overId: string): string | null {
    if (overId === UNGROUPED) return UNGROUPED
    if (groups.some((g) => g.id === overId)) return overId
    return findContainerOf(overId)
  }

  function containerComponents(containerId: string): StatusComponentAdmin[] {
    if (containerId === UNGROUPED) return ungrouped
    return groups.find((g) => g.id === containerId)?.components ?? []
  }

  function setContainerComponents(containerId: string, next: StatusComponentAdmin[]) {
    if (containerId === UNGROUPED) {
      setUngrouped(next)
    } else {
      setGroups((prev) => prev.map((g) => (g.id === containerId ? { ...g, components: next } : g)))
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id)
    const component =
      ungrouped.find((c) => c.id === id) ??
      groups.flatMap((g) => g.components).find((c) => c.id === id) ??
      null
    setActiveDrag(component)
  }

  /** Cross-container moves happen live during the drag (the canonical
   *  dnd-kit multi-container pattern); the drop only commits. */
  function handleDragOver(event: DragOverEvent) {
    if (!activeDrag || dragDisabled) return
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    const from = findContainerOf(activeId)
    const to = resolveContainer(overId)
    if (!from || !to || from === to) return

    const moving = containerComponents(from).find((c) => c.id === activeId)
    if (!moving) return
    const target = containerComponents(to)
    // Over a component: insert at its index. Over a header/zone: append.
    const overIndex = target.findIndex((c) => c.id === overId)
    const insertAt = overIndex === -1 ? target.length : overIndex

    setContainerComponents(
      from,
      containerComponents(from).filter((c) => c.id !== activeId)
    )
    setContainerComponents(to, [...target.slice(0, insertAt), moving, ...target.slice(insertAt)])
  }

  function resetFromServer() {
    if (data) {
      setGroups(data.groups)
      setUngrouped(data.ungrouped)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (dragDisabled) return

    // Groups themselves can be reordered when the dragged id matches a group.
    const groupIndex = groups.findIndex((g) => g.id === active.id)
    if (groupIndex !== -1) {
      if (!over || active.id === over.id) return
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

    // Otherwise it's a component. The mid-drag container moves in
    // handleDragOver are a cosmetic preview only; the commit is computed
    // from SERVER truth + the drop target, because the last onDragOver's
    // setState may not have flushed by the time the drop fires. Only the
    // active row ever moves locally, so every other row's server container
    // is reliable.
    if (!data) return
    const activeId = String(active.id)
    // `over` is frequently the dragged row itself: after handleDragOver moved
    // it across containers, the pointer sits on its own preview slot. In that
    // case (and when over is null) the LOCAL preview state is the answer, and
    // it is guaranteed flushed: dnd-kit measured the active row's droppable
    // rect at its new home to produce over === active in the first place.
    const overId = over && String(over.id) !== activeId ? String(over.id) : null
    const allServer = [...data.ungrouped, ...data.groups.flatMap((g) => g.components)]
    const moving = allServer.find((c) => c.id === activeId)
    if (!moving) return

    const serverContainerOf = (componentId: string): string | null => {
      if (data.ungrouped.some((c) => c.id === componentId)) return UNGROUPED
      return data.groups.find((g) => g.components.some((c) => c.id === componentId))?.id ?? null
    }
    const serverListOf = (containerId: string) =>
      containerId === UNGROUPED
        ? data.ungrouped
        : (data.groups.find((g) => g.id === containerId)?.components ?? [])

    const originalContainer = serverContainerOf(activeId)
    let destContainer: string | null
    if (overId === null)
      destContainer = findContainerOf(activeId) // local preview
    else if (overId === UNGROUPED) destContainer = UNGROUPED
    else if (data.groups.some((g) => g.id === overId)) destContainer = overId
    else destContainer = serverContainerOf(overId)
    if (!originalContainer || !destContainer) {
      resetFromServer()
      return
    }

    const movedGroups = destContainer !== originalContainer
    let ordered: StatusComponentAdmin[]
    if (overId === null) {
      // Dropped on its own preview slot: place it at the previewed index
      // within the server truth of the destination.
      const localIndex = containerComponents(destContainer).findIndex((c) => c.id === activeId)
      const target = serverListOf(destContainer).filter((c) => c.id !== activeId)
      const insertAt = localIndex === -1 ? target.length : Math.min(localIndex, target.length)
      ordered = [...target.slice(0, insertAt), moving, ...target.slice(insertAt)]
      const originalIds = serverListOf(originalContainer).map((c) => c.id)
      if (!movedGroups && ordered.map((c) => c.id).join() === originalIds.join()) return
    } else if (!movedGroups) {
      // Same container: canonical sortable semantics (take the over item's slot).
      const list = serverListOf(originalContainer)
      const from = list.findIndex((c) => c.id === activeId)
      const to = list.findIndex((c) => c.id === overId)
      if (from === -1 || to === -1 || from === to) {
        resetFromServer()
        return
      }
      ordered = arrayMove(list, from, to)
    } else {
      // Cross container: insert before the over item, or append when dropped
      // on a group header / the ungrouped zone.
      const target = serverListOf(destContainer).filter((c) => c.id !== activeId)
      const overIndex = target.findIndex((c) => c.id === overId)
      const insertAt = overIndex === -1 ? target.length : overIndex
      ordered = [...target.slice(0, insertAt), moving, ...target.slice(insertAt)]
    }

    // Reflect the final arrangement locally right away (the refetch confirms).
    const stripActive = (list: StatusComponentAdmin[]) => list.filter((c) => c.id !== activeId)
    setUngrouped(destContainer === UNGROUPED ? ordered : stripActive(data.ungrouped))
    setGroups(
      data.groups.map((g) =>
        g.id === destContainer
          ? { ...g, components: ordered }
          : { ...g, components: stripActive(g.components) }
      )
    )

    commitInFlight.current = true
    try {
      if (movedGroups) {
        await updateComponentMutation.mutateAsync({
          id: activeId,
          groupId: destContainer === UNGROUPED ? null : destContainer,
        })
      }
      await reorderComponents.mutateAsync(ordered.map((c) => c.id))
    } catch {
      toast.error('Failed to move service')
      resetFromServer()
    } finally {
      commitInFlight.current = false
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
    <div className="max-w-4xl w-full flex flex-col flex-1 min-h-0">
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
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={(e) => {
              setActiveDrag(null)
              void handleDragEnd(e)
            }}
            onDragCancel={() => {
              setActiveDrag(null)
              resetFromServer()
            }}
          >
            <div className="rounded-xl overflow-hidden border border-border/50 bg-card shadow-sm divide-y divide-border/50">
              {activeDrag && ungrouped.length === 0 && <UngroupedDropZone />}
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

            <DragOverlay>
              {activeDrag ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium shadow-lg">
                  <Bars3Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {activeDrag.name}
                </div>
              ) : null}
            </DragOverlay>
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

/** Drop target for pulling a service out of every group when the ungrouped
 *  section has no rows to drop onto. Only rendered mid-drag. */
function UngroupedDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: '__ungrouped__' })
  return (
    <div
      ref={setNodeRef}
      className={`px-3 py-2.5 text-xs border-2 border-dashed rounded-lg m-2 text-center transition-colors ${
        isOver
          ? 'border-primary/60 bg-primary/5 text-foreground'
          : 'border-border/60 text-muted-foreground'
      }`}
    >
      Drop here to remove from its group
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: group.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-3 py-2 transition-colors ${
        isOver ? 'bg-primary/10' : 'bg-muted/40'
      }`}
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

      <StatusSelect
        value={component.status}
        options={COMPONENT_STATUS_OPTIONS}
        onChange={(v) => onStatusChange(component.id, v as StatusComponentStatus)}
      />

      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Service actions">
              <EllipsisHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <PencilSquareIcon className="mr-2 h-4 w-4" />
              Edit service
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={component.showUptime}
              onCheckedChange={(c) => onUptimeToggle(component, c === true)}
            >
              Show uptime bar
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              Delete service
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
