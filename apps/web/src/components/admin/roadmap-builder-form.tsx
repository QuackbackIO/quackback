import { useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RoadmapView } from '@/lib/client/hooks/use-roadmaps-query'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import type { BoardId, PostStatusId, PostTagId, RoadmapColumnId, SegmentId } from '@quackback/ids'
import type { RoadmapFrequency, RoadmapType, RoadmapVisibility } from '@/lib/shared/roadmap-config'

export interface RoadmapBuilderValue {
  name: string
  description?: string
  type: RoadmapType
  baseFilter: {
    statusIds?: PostStatusId[]
    boardIds?: BoardId[]
    tagIds?: PostTagId[]
    segmentIds?: SegmentId[]
  }
  frequency: RoadmapFrequency | null
  visibility: RoadmapVisibility
  visibleSegmentIds: SegmentId[] | null
  columns: Array<{
    id?: RoadmapColumnId
    statusId: PostStatusId
    name: string
    icon: string | null
    color: string
    position: number
  }>
}

interface NamedOption {
  id: string
  name: string
}

interface RoadmapBuilderFormProps {
  roadmap?: RoadmapView | null
  statuses: PostStatusEntity[]
  boards: NamedOption[]
  tags: NamedOption[]
  segments: NamedOption[]
  isPending: boolean
  submitLabel: string
  onCancel: () => void
  onSubmit: (value: RoadmapBuilderValue) => Promise<void>
}

function initialColumns(roadmap: RoadmapView | null | undefined, statuses: PostStatusEntity[]) {
  if (roadmap) {
    return roadmap.columns.map(({ roadmapId: _roadmapId, ...column }) => column)
  }
  return statuses
    .filter((status) => status.showOnRoadmap)
    .map((status, position) => ({
      statusId: status.id,
      name: status.name,
      icon: null,
      color: status.color,
      position,
    }))
}

function FilterOptions({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: NamedOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  if (!options.length) return null
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {options.map((option) => {
          const checked = selected.includes(option.id)
          return (
            <label key={option.id} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox
                checked={checked}
                onCheckedChange={(next) =>
                  onChange(
                    next ? [...selected, option.id] : selected.filter((id) => id !== option.id)
                  )
                }
              />
              {option.name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function RoadmapBuilderForm({
  roadmap,
  statuses,
  boards,
  tags,
  segments,
  isPending,
  submitLabel,
  onCancel,
  onSubmit,
}: RoadmapBuilderFormProps) {
  const [name, setName] = useState(roadmap?.name ?? '')
  const [description, setDescription] = useState(roadmap?.description ?? '')
  const [type, setType] = useState<RoadmapType>(roadmap?.type ?? 'column')
  const [frequency, setFrequency] = useState<RoadmapFrequency>(roadmap?.frequency ?? 'monthly')
  const [visibility, setVisibility] = useState<RoadmapVisibility>(roadmap?.visibility ?? 'public')
  const [visibleSegmentIds, setVisibleSegmentIds] = useState<string[]>(
    roadmap?.visibleSegmentIds ?? []
  )
  const [statusIds, setStatusIds] = useState<string[]>(roadmap?.baseFilter.statusIds ?? [])
  const [boardIds, setBoardIds] = useState<string[]>(roadmap?.baseFilter.boardIds ?? [])
  const [tagIds, setTagIds] = useState<string[]>(roadmap?.baseFilter.tagIds ?? [])
  const [segmentIds, setSegmentIds] = useState<string[]>(roadmap?.baseFilter.segmentIds ?? [])
  const [columns, setColumns] = useState<RoadmapBuilderValue['columns']>(() =>
    initialColumns(roadmap, statuses)
  )

  function toggleColumn(status: PostStatusEntity, checked: boolean) {
    if (!checked) {
      setColumns((current) =>
        current
          .filter((column) => column.statusId !== status.id)
          .map((column, position) => ({ ...column, position }))
      )
      return
    }
    setColumns((current) => [
      ...current,
      {
        statusId: status.id,
        name: status.name,
        icon: null,
        color: status.color,
        position: current.length,
      },
    ])
  }

  function moveColumn(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= columns.length) return
    setColumns((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((column, position) => ({ ...column, position }))
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    await onSubmit({
      name,
      description: description || undefined,
      type,
      baseFilter: {
        ...(statusIds.length ? { statusIds: statusIds as PostStatusId[] } : {}),
        ...(boardIds.length ? { boardIds: boardIds as BoardId[] } : {}),
        ...(tagIds.length ? { tagIds: tagIds as PostTagId[] } : {}),
        ...(segmentIds.length ? { segmentIds: segmentIds as SegmentId[] } : {}),
      },
      frequency: type === 'date' ? frequency : null,
      visibility,
      visibleSegmentIds: visibility === 'segment' ? (visibleSegmentIds as SegmentId[]) : null,
      columns:
        type === 'column' ? columns.map((column, position) => ({ ...column, position })) : [],
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ScrollArea className="max-h-[65vh] overflow-hidden -mx-1 px-1">
        <div className="space-y-5 pe-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="roadmap-name">Name</Label>
              <Input
                id="roadmap-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Product roadmap"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roadmap-type">Layout</Label>
              <select
                id="roadmap-type"
                className={selectClass}
                value={type}
                onChange={(event) => setType(event.target.value as RoadmapType)}
              >
                <option value="column">Status columns</option>
                <option value="date">Date periods</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="roadmap-description">Description</Label>
            <Input
              id="roadmap-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this view communicates"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {type === 'date' && (
              <div className="space-y-2">
                <Label htmlFor="roadmap-frequency">Frequency</Label>
                <select
                  id="roadmap-frequency"
                  className={selectClass}
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as RoadmapFrequency)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semiannual">Semiannual</option>
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="roadmap-visibility">Visibility</Label>
              <select
                id="roadmap-visibility"
                className={selectClass}
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as RoadmapVisibility)}
              >
                <option value="public">Public</option>
                <option value="team">Team only</option>
                <option value="segment">Customer segments</option>
              </select>
            </div>
          </div>

          {visibility === 'segment' && (
            <div className="rounded-lg border border-border/60 p-3">
              <FilterOptions
                label="Visible to"
                options={segments}
                selected={visibleSegmentIds}
                onChange={setVisibleSegmentIds}
              />
              {!visibleSegmentIds.length && (
                <p className="mt-2 text-xs text-destructive">Select at least one segment.</p>
              )}
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div>
              <h3 className="text-sm font-medium">Base filter</h3>
              <p className="text-xs text-muted-foreground">
                Posts must match these constraints before placement.
              </p>
            </div>
            <FilterOptions
              label="Statuses"
              options={statuses}
              selected={statusIds}
              onChange={setStatusIds}
            />
            <FilterOptions
              label="Boards"
              options={boards}
              selected={boardIds}
              onChange={setBoardIds}
            />
            <FilterOptions label="Tags" options={tags} selected={tagIds} onChange={setTagIds} />
            <FilterOptions
              label="Author segments"
              options={segments}
              selected={segmentIds}
              onChange={setSegmentIds}
            />
          </div>

          {type === 'column' && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div>
                <h3 className="text-sm font-medium">Columns</h3>
                <p className="text-xs text-muted-foreground">
                  Each status can appear once. Dragging a card changes only its status.
                </p>
              </div>
              <div className="space-y-2">
                {statuses.map((status) => {
                  const columnIndex = columns.findIndex((column) => column.statusId === status.id)
                  const column = columns[columnIndex]
                  return (
                    <div key={status.id} className="rounded-md bg-muted/35 p-2.5">
                      <label className="flex items-center gap-2 text-[13px] font-medium">
                        <Checkbox
                          checked={!!column}
                          onCheckedChange={(checked) => toggleColumn(status, !!checked)}
                        />
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: status.color }}
                        />
                        {status.name}
                      </label>
                      {column && (
                        <div className="mt-2 grid grid-cols-[1fr_90px_auto] gap-2 ps-6">
                          <Input
                            value={column.name}
                            aria-label={`${status.name} column name`}
                            onChange={(event) =>
                              setColumns((current) =>
                                current.map((item, index) =>
                                  index === columnIndex
                                    ? { ...item, name: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <Input
                            value={column.icon ?? ''}
                            aria-label={`${status.name} column icon`}
                            placeholder="Icon"
                            onChange={(event) =>
                              setColumns((current) =>
                                current.map((item, index) =>
                                  index === columnIndex
                                    ? { ...item, icon: event.target.value || null }
                                    : item
                                )
                              )
                            }
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="color"
                              value={column.color}
                              aria-label={`${status.name} column color`}
                              onChange={(event) =>
                                setColumns((current) =>
                                  current.map((item, index) =>
                                    index === columnIndex
                                      ? { ...item, color: event.target.value }
                                      : item
                                  )
                                )
                              }
                              className="size-8 rounded border border-input bg-background p-1"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={columnIndex === 0}
                              onClick={() => moveColumn(columnIndex, -1)}
                              aria-label={`Move ${status.name} left`}
                            >
                              <ChevronLeftIcon className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={columnIndex === columns.length - 1}
                              onClick={() => moveColumn(columnIndex, 1)}
                              aria-label={`Move ${status.name} right`}
                            >
                              <ChevronRightIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            isPending ||
            (visibility === 'segment' && !visibleSegmentIds.length) ||
            (type === 'column' && !columns.length)
          }
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
