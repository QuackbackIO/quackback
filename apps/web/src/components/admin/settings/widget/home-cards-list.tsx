import { useId, useState, type ReactNode } from 'react'
import { Bars3Icon, PlusIcon } from '@heroicons/react/24/solid'
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
import { SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StateBadge } from '@/components/shared/state-badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/shared/utils'
import type {
  WidgetCardAudience,
  WidgetHomeCard,
  WidgetHomeCardType,
} from '@/lib/shared/types/settings'

export const MAX_HOME_CARDS = 8

const CARD_TYPE_LABEL: Record<WidgetHomeCardType, string> = {
  feedback: 'Feedback',
  new_conversation: 'New conversation',
  article_search: 'Article search',
  latest_updates: 'Latest updates',
  link: 'Link',
}

const AUDIENCE_LABEL: Record<WidgetCardAudience, string> = {
  everyone: 'Show to everyone',
  anonymous: 'Signed-out visitors only',
  identified: 'Signed-in users only',
}

function rowTitle(card: WidgetHomeCard): string {
  return card.title || CARD_TYPE_LABEL[card.type] || card.type
}

/** The muted second line: the card kind when it has a custom title, and a non-default audience. */
function rowMeta(card: WidgetHomeCard): string | undefined {
  const parts: string[] = []
  if (card.title) parts.push(CARD_TYPE_LABEL[card.type] ?? card.type)
  if (card.audience && card.audience !== 'everyone') parts.push(AUDIENCE_LABEL[card.audience])
  return parts.length ? parts.join(' · ') : undefined
}

interface HomeCardsListProps {
  cards: WidgetHomeCard[]
  /** Receives the full replacement array (order matters). */
  onChange: (next: WidgetHomeCard[]) => void
  disabled?: boolean
}

/**
 * The widget Home cards as compact, draggable rows. A row's menu opens the
 * editor in a dialog; every card field stays editable there.
 */
export function HomeCardsList({ cards, onChange, disabled = false }: HomeCardsListProps) {
  const dndId = useId()
  const [editingId, setEditingId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const editing = cards.find((c) => c.id === editingId) ?? null

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = cards.findIndex((c) => c.id === active.id)
    const to = cards.findIndex((c) => c.id === over.id)
    if (from < 0 || to < 0) return
    onChange(arrayMove(cards, from, to))
  }

  function updateCard(id: string, patch: Partial<WidgetHomeCard>) {
    onChange(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Home cards</Label>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || cards.length >= MAX_HOME_CARDS}
          onClick={() =>
            onChange([...cards, { id: crypto.randomUUID(), type: 'link', title: '', url: '' }])
          }
        >
          <PlusIcon className="size-3.5 me-1.5" />
          Add link card
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/50">
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <SettingsList>
              {cards.map((card) => (
                <SortableCardRow key={card.id} id={card.id}>
                  {(grip) => (
                    <SettingsListRow
                      grip={grip}
                      title={rowTitle(card)}
                      meta={rowMeta(card)}
                      badges={card.enabled === false ? <StateBadge state="off" /> : undefined}
                      actionsLabel={rowTitle(card)}
                      actions={[
                        { label: 'Edit', onSelect: () => setEditingId(card.id) },
                        ...(card.type === 'link'
                          ? []
                          : [
                              {
                                label: card.enabled === false ? 'Show' : 'Hide',
                                disabled,
                                onSelect: () =>
                                  updateCard(card.id, { enabled: card.enabled === false }),
                              },
                            ]),
                        ...(card.type === 'link'
                          ? [
                              {
                                label: 'Remove',
                                destructive: true,
                                disabled,
                                onSelect: () => onChange(cards.filter((c) => c.id !== card.id)),
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                </SortableCardRow>
              ))}
            </SettingsList>
          </SortableContext>
        </DndContext>
      </div>

      <p className="text-[13px] text-muted-foreground">
        Drag to reorder. Built-in cards hide when their section is off.
      </p>

      {editing && (
        <EditCardDialog
          key={editing.id}
          card={editing}
          disabled={disabled}
          onClose={() => setEditingId(null)}
          onSave={(patch) => {
            updateCard(editing.id, patch)
            setEditingId(null)
          }}
        />
      )}
    </div>
  )
}

function EditCardDialog({
  card,
  disabled,
  onClose,
  onSave,
}: {
  card: WidgetHomeCard
  disabled: boolean
  onClose: () => void
  onSave: (patch: Partial<WidgetHomeCard>) => void
}) {
  const [title, setTitle] = useState(card.title ?? '')
  const [subtitle, setSubtitle] = useState(card.subtitle ?? '')
  const [url, setUrl] = useState(card.url ?? '')
  const [audience, setAudience] = useState<WidgetCardAudience>(card.audience ?? 'everyone')
  const isLink = card.type === 'link'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const patch: Partial<WidgetHomeCard> = {
      title: title.trim() || undefined,
      subtitle: subtitle.trim() || undefined,
      audience: audience === 'everyone' ? undefined : audience,
    }
    if (isLink) patch.url = url.trim()
    onSave(patch)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {CARD_TYPE_LABEL[card.type].toLowerCase()} card</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="home-card-title">Title</Label>
            <Input
              id="home-card-title"
              value={title}
              maxLength={80}
              placeholder="Default"
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="home-card-subtitle">Subtitle</Label>
            <Input
              id="home-card-subtitle"
              value={subtitle}
              maxLength={160}
              placeholder="Default"
              onChange={(e) => setSubtitle(e.target.value)}
              disabled={disabled}
            />
          </div>
          {isLink && (
            <div className="space-y-2">
              <Label htmlFor="home-card-url">URL</Label>
              <Input
                id="home-card-url"
                value={url}
                maxLength={2000}
                placeholder="https://example.com"
                onChange={(e) => setUrl(e.target.value)}
                disabled={disabled}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="home-card-audience">Audience</Label>
            <Select
              value={audience}
              onValueChange={(val: WidgetCardAudience) => setAudience(val)}
              disabled={disabled}
            >
              <SelectTrigger id="home-card-audience" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIENCE_LABEL) as WidgetCardAudience[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {AUDIENCE_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One sortable row; the render prop hands in the drag grip (keyboard reorder works through it). */
function SortableCardRow({
  id,
  children,
}: {
  id: string
  children: (grip: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const grip = (
    <button
      type="button"
      className="cursor-grab touch-none text-muted-foreground/70 active:cursor-grabbing"
      aria-label="Reorder card"
      {...attributes}
      {...listeners}
    >
      <Bars3Icon className="size-4" />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-60')}
    >
      {children(grip)}
    </div>
  )
}
