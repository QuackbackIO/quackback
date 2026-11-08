import { useId } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  EyeIcon,
  EyeSlashIcon,
  HomeIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { landingOf, landingOptions, menuParts, type MenuPart } from '@/lib/shared/design/menu'
import {
  HEADER_COPY,
  MENU_COPY,
  clickMenu,
  type MenuAction,
} from '@/lib/shared/design/menu-actions'
import { PAGE_NAMES } from '@/lib/shared/design/outline'
import type { PortalPageGates, PortalPageType } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  type Crumb,
} from './properties/properties-panel'
import { ReachNote } from './properties/scope-line'
import { COLOUR_NAMES, WORDS } from './properties/words'
import { Tag } from './tag'
import { useNewParts } from './use-new-parts'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

type PanelAction = MenuAction | 'show'

const LAYOUTS = [
  ['stacked', 'Stacked'],
  ['inline', 'Inline'],
  ['centered', 'Centred'],
] as const

const MENU_STYLES = [
  ['tabs', 'Tabs'],
  ['underline', 'Underline'],
  ['pills', 'Pills'],
  ['plain', 'Plain'],
] as const

/** What the logo shows, in a word or two, on its row. */
const LOGO_SHOWS: Record<PortalDesign['brand']['logo']['display'], string> = {
  mark_and_name: 'Icon and title',
  mark: 'Icon',
  name: 'Title',
  wordmark: 'Full logo',
}

interface RowAction {
  action: PanelAction
  label: string
  disabled?: boolean
  Icon: typeof PencilIcon
}

/** The actions an item's ⋯ offers, as its click menu does; Rename happens where the menu draws it. */
function rowActions(design: PortalDesign, gates: PortalPageGates, part: MenuPart): RowAction[] {
  const menu = clickMenu(design, gates, part.id)
  const entry = (action: MenuAction) => menu?.entries.find((each) => each.action === action)
  const go = entry('go')
  const left = entry('left')
  const right = entry('right')
  const actions: Array<RowAction | false | undefined> = [
    go && { action: 'go', label: go.label, Icon: ArrowRightIcon },
    entry('edit-link') && { action: 'edit-link', label: MENU_COPY.editLink, Icon: LinkIcon },
    // A hidden item is not drawn, so there is nowhere to rename it.
    { action: 'rename', label: MENU_COPY.rename, disabled: !part.shown, Icon: PencilIcon },
    entry('land') && { action: 'land', label: MENU_COPY.land, Icon: HomeIcon },
    left && { action: 'left', label: MENU_COPY.left, disabled: left.disabled, Icon: ArrowLeftIcon },
    right && {
      action: 'right',
      label: MENU_COPY.right,
      disabled: right.disabled,
      Icon: ArrowRightIcon,
    },
    entry('remove') && { action: 'remove', label: MENU_COPY.remove, Icon: TrashIcon },
  ]
  return actions.filter((each): each is RowAction => !!each)
}

/**
 * The header's panel, on the properties frame: a row into the logo (its own
 * element), its layout, the menu as rows (Hide or Show on the row, the rest
 * under ⋯, a link opening its own settings), the landing page, and the
 * menu's style. Names are changed where the menu draws them. There is one
 * header, on every page.
 */
export function HeaderPanel({
  crumbs,
  pages,
  design,
  gates,
  update,
  act,
  onAdd,
  onLogo,
  onLanding,
}: {
  crumbs: readonly Crumb[]
  /** How many pages the builder shows, each with the header. */
  pages: number
  design: PortalDesign
  gates: PortalPageGates
  update: NamedUpdate
  act: (target: MenuPart['id'], action: PanelAction, from: 'panel') => void
  onAdd: () => void
  /** Picks the logo, its own element in the header. */
  onLogo: () => void
  onLanding: (target: 'home' | PortalPageType) => void
}) {
  const id = useId()
  const fresh = useNewParts(gates)
  const parts = menuParts(design, gates)
  const landing = landingOf(design, gates)
  const { layout } = design
  const nameOf = (target: 'home' | PortalPageType) =>
    parts.find((part) => part.id === target)?.label ?? PAGE_NAMES[target]
  return (
    <PropertiesPanel
      crumbs={crumbs}
      title={HEADER_COPY.title}
      className="pb-24"
      data-header-panel=""
      scope={<ReachNote phrase="the header" count={pages} countNote="pages" />}
    >
      <PropertySection>
        <PropertyRow label={HEADER_COPY.logo}>
          <button
            type="button"
            aria-label={`${HEADER_COPY.logo}: ${LOGO_SHOWS[design.brand.logo.display]}`}
            onClick={onLogo}
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-start text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 truncate">{LOGO_SHOWS[design.brand.logo.display]}</span>
            <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </PropertyRow>
      </PropertySection>

      <PropertySection title={HEADER_COPY.layout}>
        <PropertyRow label={HEADER_COPY.layout}>
          <PropertyTiles
            label={HEADER_COPY.layout}
            value={layout.header}
            options={LAYOUTS}
            onChange={(header) =>
              update((draft) => void (draft.layout.header = header), 'Header layout')
            }
          />
        </PropertyRow>
        {layout.header === 'inline' && (
          <PropertyRow label="Menu position">
            <PropertyTiles
              label="Menu position"
              value={layout.menuAlign ?? 'start'}
              options={[
                ['start', 'By the logo'],
                ['centre', 'Centred'],
              ]}
              onChange={(align) =>
                update((draft) => {
                  if (align === 'start') delete draft.layout.menuAlign
                  else draft.layout.menuAlign = align
                }, 'Menu position')
              }
            />
          </PropertyRow>
        )}
        {layout.band !== 'none' && (
          <PropertyRow label="Blend into hero" htmlFor={`${id}-blend`}>
            <Switch
              id={`${id}-blend`}
              aria-label="Header blends into the hero"
              checked={layout.headerOnBand === true}
              onCheckedChange={(on) =>
                update((draft) => {
                  if (on) draft.layout.headerOnBand = true
                  else delete draft.layout.headerOnBand
                }, 'Header blends into the hero')
              }
            />
          </PropertyRow>
        )}
      </PropertySection>

      <PropertySection title={HEADER_COPY.menu}>
        <ul aria-label={HEADER_COPY.menu} className="-mx-1.5">
          {parts.map((part) => (
            <MenuRow
              key={part.id}
              part={part}
              fresh={fresh.includes(part.id as PortalPageType)}
              actions={rowActions(design, gates, part)}
              stays={
                !!clickMenu(design, gates, part.id)?.entries.find((e) => e.action === 'hide')
                  ?.disabled
              }
              onAct={(action) => act(part.id, action, 'panel')}
            />
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="-ms-1.5 h-7 px-1.5 text-xs" onClick={onAdd}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {HEADER_COPY.add}
        </Button>
        <PropertyRow label={HEADER_COPY.land} source={HEADER_COPY.landHelp}>
          <PropertyTiles
            label={HEADER_COPY.land}
            value={landing}
            options={landingOptions(design, gates).map(
              (option) => [option, nameOf(option)] as const
            )}
            onChange={onLanding}
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection title={HEADER_COPY.menuStyle}>
        <PropertyRow label="Style">
          <PropertyTiles
            label={HEADER_COPY.menuStyle}
            value={layout.nav}
            options={MENU_STYLES}
            onChange={(nav) => update((draft) => void (draft.layout.nav = nav), 'Menu style')}
          />
        </PropertyRow>
        <PropertyRow label="Text">
          <PropertyTiles
            label="Menu text"
            value={layout.navText ?? 'muted'}
            options={[
              ['muted', COLOUR_NAMES.muted],
              ['ink', COLOUR_NAMES.ink],
            ]}
            onChange={(text) => update((draft) => void (draft.layout.navText = text), 'Menu text')}
          />
        </PropertyRow>
      </PropertySection>
    </PropertiesPanel>
  )
}

/** One item of the menu: its name and tags, Hide or Show, and its other actions under ⋯. */
function MenuRow({
  part,
  fresh,
  actions,
  stays,
  onAct,
}: {
  part: MenuPart
  fresh: boolean
  actions: RowAction[]
  /** Whether it must stay in the menu, being where visitors land. */
  stays: boolean
  onAct: (action: PanelAction) => void
}) {
  const link = part.kind === 'link'
  const Eye = part.shown ? EyeIcon : EyeSlashIcon
  return (
    <li className="flex min-h-7 items-center gap-1 rounded-md px-1.5 hover:bg-muted/60">
      <button
        type="button"
        className={cn(
          'flex min-w-0 flex-1 items-center rounded text-start text-xs focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
          !part.shown && 'text-muted-foreground'
        )}
        // A link opens its own settings; a double-click renames where the menu draws it.
        onClick={() => link && onAct('edit-link')}
        onDoubleClick={() => part.shown && onAct('rename')}
      >
        <span className="min-w-0 truncate">{part.label}</span>
        {!part.shown && <Tag>{HEADER_COPY.hidden}</Tag>}
        {part.lands && <Tag>{MENU_COPY.landsHere}</Tag>}
        {fresh && (
          <span title="Turned on since you last opened the builder">
            <Tag tone="new">New</Tag>
          </span>
        )}
      </button>
      {!link && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 shrink-0"
          disabled={part.shown && stays}
          title={part.shown && stays ? MENU_COPY.landsHere : undefined}
          aria-label={`${part.shown ? WORDS.hide : WORDS.show} ${part.label}`}
          onClick={() => onAct(part.shown ? 'hide' : 'show')}
        >
          <Eye className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0"
            aria-label={`Actions for ${part.label}`}
          >
            <EllipsisHorizontalIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {actions.map(({ action, label, disabled, Icon }) => (
            <DropdownMenuItem
              key={action}
              disabled={disabled}
              className="py-1.5 text-[13px]"
              onClick={() => onAct(action)}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
