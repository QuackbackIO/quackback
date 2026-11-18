import { memo, useId } from 'react'
import { Link } from '@tanstack/react-router'
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
import type { PortalSection } from '@/lib/shared/custom-domains'
import { PORTAL_SECTIONS, type SectionDomainMap } from '@/lib/shared/section-domains'
import { CUSTOM_DOMAINS_LINK } from '@/lib/shared/portal-settings-tabs'

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

/**
 * The hostname each tab is served at, for the line under it: only a verified
 * one, as routing sends visitors only there. A pending domain serves nothing yet.
 */
export function servedSectionHosts(map: SectionDomainMap): Partial<Record<PortalSection, string>> {
  const hosts: Partial<Record<PortalSection, string>> = {}
  for (const section of PORTAL_SECTIONS) {
    const entry = map[section]
    if (entry?.verifiedAt) hosts[section] = entry.hostname
  }
  return hosts
}

interface PortalNavEditorProps {
  items: PortalNavItemConfig[]
  onChange: (items: PortalNavItemConfig[]) => void
  /** Built-in types whose product is currently disabled (rows render inert). */
  gatedTypes: ReadonlySet<string>
  onReset: () => void
  /** The hostname a tab's section is served at, when it has one of its own (set on the Custom domains tab). */
  sectionHosts?: Partial<Record<PortalSection, string>>
  /** The viewer has the Custom domains tab: each domain line links there. */
  linkSectionHosts?: boolean
}

/**
 * Draft editor for the portal top-nav: drag to reorder, toggle to hide,
 * click a label to rename, add external links. Pure controlled component:
 * the page owns the draft array and commits it wholesale on Save.
 */
export const PortalNavEditor = memo(function PortalNavEditor({
  items,
  onChange,
  gatedTypes,
  onReset,
  sectionHosts,
  linkSectionHosts = false,
}: PortalNavEditorProps) {
  const dndId = useId()
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
    <TooltipProvider delay={200}>
      <div className="divide-y divide-border/50">
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {items.map((item) => (
              <NavRow
                key={item.id}
                item={item}
                gated={item.type !== 'link' && gatedTypes.has(item.type)}
                host={item.type !== 'link' ? sectionHosts?.[item.type] : undefined}
                linkHost={linkSectionHosts}
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
})

function NavRow({
  item,
  gated,
  host,
  linkHost,
  onPatch,
  onRemove,
}: {
  item: PortalNavItemConfig
  gated: boolean
  /** The tab's own domain, shown as one quiet line under it. */
  host?: string
  /** The line links to the Custom domains tab, where the domain is set. */
  linkHost: boolean
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
  // Only flag once something was typed: a fresh empty row isn't an error yet.
  const urlInvalid = isLink && !!item.url && !isValidNavLinkUrl(item.url)

  return (
    <div
      ref={setNodeRef}
      data-slot="nav-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('bg-background py-2', isDragging && 'relative z-10 opacity-50 shadow-md')}
    >
      <div className="flex items-center gap-2">
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
            'h-7 flex-1 border-transparent px-1.5 text-[13px]',
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
              This tab shows once its product is enabled (Settings → General). Your order and label
              are kept.
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

        {item.type === 'feedback' ? (
          <Badge variant="secondary">Always on</Badge>
        ) : (
          <Switch
            checked={item.enabled !== false}
            disabled={gated}
            onCheckedChange={(checked) => onPatch({ enabled: checked ? undefined : false })}
            aria-label={`Show ${item.label || defaultLabel} tab`}
          />
        )}
      </div>
      {host && (
        <p
          data-slot="nav-row-domain"
          // Lined up with the label's text: grip, icon and the input's own padding.
          className="mt-0.5 truncate ps-[3.8125rem] text-xs text-muted-foreground"
        >
          {linkHost ? (
            <Link
              to={CUSTOM_DOMAINS_LINK.to}
              search={CUSTOM_DOMAINS_LINK.search}
              className="hover:text-foreground hover:underline"
            >
              {host}
            </Link>
          ) : (
            host
          )}
        </p>
      )}
    </div>
  )
}
