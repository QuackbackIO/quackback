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
  BookOpenIcon,
  ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  MapIcon,
  MegaphoneIcon,
  PlusIcon,
  SignalIcon,
  TrashIcon,
} from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'
import {
  builtInNavDefinition,
  type PortalBuiltInNavType,
} from '@/components/public/portal-header-nav'
import type { PortalNavItemConfig } from '@/lib/shared/types/settings'

const TYPE_ICONS: Record<string, typeof ChatBubbleLeftIcon> = {
  feedback: ChatBubbleLeftIcon,
  roadmap: MapIcon,
  changelog: MegaphoneIcon,
  help: BookOpenIcon,
  support: ChatBubbleLeftRightIcon,
  status: SignalIcon,
  link: LinkIcon,
}

export function isValidNavLinkUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\/\S+\.\S+/i.test(url)
}

interface PortalNavEditorProps {
  items: PortalNavItemConfig[]
  onChange: (items: PortalNavItemConfig[]) => void
  /** Built-in types whose product is currently disabled (rows render inert). */
  gatedTypes: ReadonlySet<string>
  onReset: () => void
}

/**
 * Draft editor for the portal top-nav: drag to reorder, toggle to hide,
 * click a label to rename, add external links. Pure controlled component —
 * the page owns the draft array and commits it wholesale on Save.
 */
export function PortalNavEditor({ items, onChange, gatedTypes, onReset }: PortalNavEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(items, oldIndex, newIndex))
  }

  function updateItem(id: string, patch: Partial<PortalNavItemConfig>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  function removeItem(id: string) {
    onChange(items.filter((i) => i.id !== id))
  }

  function addLink() {
    onChange([
      ...items,
      { id: crypto.randomUUID(), type: 'link', label: '', url: '', newTab: true },
    ])
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-1.5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {items.map((item) => (
              <NavRow
                key={item.id}
                item={item}
                gated={item.type !== 'link' && gatedTypes.has(item.type)}
                onPatch={(patch) => updateItem(item.id, patch)}
                onRemove={() => removeItem(item.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addLink}>
          <PlusIcon className="size-3.5 me-1.5" />
          Add link
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onReset}>
          Reset to defaults
        </Button>
      </div>
    </TooltipProvider>
  )
}

function NavRow({
  item,
  gated,
  onPatch,
  onRemove,
}: {
  item: PortalNavItemConfig
  gated: boolean
  onPatch: (patch: Partial<PortalNavItemConfig>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const isLink = item.type === 'link'
  const defaultLabel = isLink
    ? 'Link'
    : builtInNavDefinition(item.type as PortalBuiltInNavType).defaultMessage
  // Only flag once something was typed — a fresh empty row isn't an error yet.
  const urlInvalid = isLink && !!item.url && !isValidNavLinkUrl(item.url)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2 py-1.5',
        isDragging && 'opacity-50 shadow-md',
        gated && 'bg-muted/40'
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none p-1 text-muted-foreground/60 hover:text-muted-foreground"
        aria-label={`Reorder ${item.label || defaultLabel}`}
        {...attributes}
        {...listeners}
      >
        <Bars3Icon className="size-3.5" />
      </button>

      {(() => {
        const Icon = TYPE_ICONS[item.type] ?? LinkIcon
        return (
          <Icon
            className={cn(
              'size-4 shrink-0',
              gated ? 'text-muted-foreground/40' : 'text-muted-foreground'
            )}
          />
        )
      })()}

      <Input
        value={item.label ?? ''}
        placeholder={defaultLabel}
        maxLength={30}
        aria-label={`Label for ${defaultLabel}`}
        onChange={(e) => {
          const value = e.target.value
          // Empty override = keep the (localized) default label.
          onPatch({ label: value.trim() === '' ? undefined : value })
        }}
        className={cn(
          'h-7 flex-1 border-transparent bg-transparent px-1.5 text-[13px] shadow-none',
          'hover:border-border focus-visible:border-input',
          gated && 'text-muted-foreground'
        )}
      />

      {isLink && (
        <Input
          value={item.url ?? ''}
          placeholder="https://…"
          aria-label="Link URL"
          onChange={(e) => onPatch({ url: e.target.value })}
          className={cn('h-7 w-40 px-1.5 text-[13px]', urlInvalid && 'border-destructive/60')}
        />
      )}

      {gated && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Badge size="sm" variant="outline" className="text-muted-foreground">
                Product off
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            This tab shows once its product is enabled (Settings → Labs / product settings). Your
            order and label are kept.
          </TooltipContent>
        </Tooltip>
      )}

      {isLink && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Remove link"
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      )}

      <Switch
        checked={item.enabled !== false}
        disabled={gated}
        onCheckedChange={(checked) => onPatch({ enabled: checked ? undefined : false })}
        aria-label={`Show ${item.label || defaultLabel} tab`}
      />
    </div>
  )
}
