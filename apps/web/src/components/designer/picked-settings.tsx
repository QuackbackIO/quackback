import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import type { ReactNode } from 'react'
import type { DesignCheck } from '@/lib/shared/design/checks'
import { linkOf, type MenuPartId } from '@/lib/shared/design/menu'
import type { DesignerPage, OutlineNode, Selection } from '@/lib/shared/design/outline'
import type { PanelRoute, RouteCrumb } from '@/lib/shared/design/panel-routes'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { HeaderPanel } from './header-panel'
import { HeroPanel } from './hero-panel'
import { Inspector, type InspectorPart } from './inspector'
import { LogoPanel } from './logo-panel'
import { MenuPartSettings } from './menu-part-settings'
import { PagePanel } from './page-panel'
import { PickedBlock } from './picked-block'
import type { Crumb } from './properties/properties-panel'
import type { MenuEditing } from './use-menu-editing'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** What the checks found in a part, as lines for its panel; nothing when they found nothing. */
function checkLines(checks: readonly DesignCheck[] | undefined, part: Selection): ReactNode {
  const found = checks?.filter((check) => check.part === part) ?? []
  if (!found.length) return undefined
  return found.map((check) => (
    <p key={check.id} className="flex items-start gap-1.5 text-foreground">
      <ExclamationTriangleIcon
        className="mt-0.5 size-3.5 shrink-0 text-warning"
        aria-hidden="true"
      />
      {check.text}
    </p>
  ))
}

/** A route's breadcrumb as the frame takes it: each crumb but the last picks its level. */
export function crumbsOf(
  crumbs: readonly RouteCrumb[],
  onSelect: (selection: Selection | null) => void
): Crumb[] {
  return crumbs.map(({ label, to }) =>
    to === undefined ? { label } : { label, onSelect: () => onSelect(to) }
  )
}

/**
 * What the right panel holds under any sheet, as the route table says: the
 * page's own panel with nothing picked, the header's, the logo's and a menu link's, the
 * hero's, a block's, or another part's. Never
 * blank: a pick with no panel of its own shows the page's.
 */
export function PickedSettings({
  route,
  selection,
  page,
  pages,
  nodes,
  design,
  update,
  gates,
  locale,
  phone,
  onPhone,
  checks,
  menu,
  onSelect,
  onTheme,
  logoUrl = null,
  say,
}: {
  route: PanelRoute
  selection: Selection | null
  page: DesignerPage
  /** How many pages the builder shows. */
  pages: number
  /** The page's outline, whose parts the page's panel lists. */
  nodes: readonly OutlineNode[]
  design: PortalDesign
  update: NamedUpdate
  gates: PortalPageGates
  locale: string
  /** Whether the canvas shows a phone. */
  phone?: boolean
  /** Shows the canvas as a phone, or on every screen. */
  onPhone?: (phone: boolean) => void
  /** What the checks found, by the part each belongs to. */
  checks?: readonly DesignCheck[]
  menu: Pick<MenuEditing, 'act' | 'land' | 'setAdding'>
  onSelect: (selection: Selection | null) => void
  /** Opens Theme, at its Style when asked. */
  onTheme: (more?: boolean) => void
  /** The workspace's logo, which the logo's panel shows until the portal has its own. */
  logoUrl?: string | null
  say: (words: string) => void
}) {
  // A menu link is not in the outline, so the route names it by its key: it goes by its own name.
  const link = route.panel === 'link' && selection ? linkOf(design, selection as MenuPartId) : null
  const crumbs = crumbsOf(
    link ? [...route.crumbs.slice(0, -1), { label: link.label }] : route.crumbs,
    onSelect
  )
  const title = route.crumbs.at(-1)?.label ?? ''
  switch (route.panel) {
    case 'header':
      return (
        <HeaderPanel
          crumbs={crumbs}
          pages={pages}
          design={design}
          gates={gates}
          update={update}
          act={menu.act}
          onAdd={() => menu.setAdding(true)}
          onLogo={() => onSelect('logo')}
          onLanding={menu.land}
        />
      )
    case 'logo':
      return <LogoPanel crumbs={crumbs} design={design} update={update} logoUrl={logoUrl} />
    case 'link':
      return (
        <MenuPartSettings
          selection={selection!}
          crumbs={crumbs}
          design={design}
          update={update}
          onRename={() => menu.act(selection as `link:${string}`, 'rename', 'panel')}
          onRemoved={() => onSelect('header')}
        />
      )
    case 'hero':
      return (
        <HeroPanel
          crumbs={crumbs}
          design={design}
          page={page}
          gates={gates}
          locale={locale}
          update={update}
          say={say}
          notes={checkLines(checks, 'hero')}
        />
      )
    case 'block':
    case 'section':
      return (
        <PickedBlock
          selection={selection!}
          crumbs={crumbs}
          design={design}
          update={update}
          locale={locale}
          gates={gates}
          phone={phone}
          onPhone={onPhone}
          checks={checks?.filter((check) => check.part === selection).map((check) => check.text)}
          onSelect={onSelect}
          say={say}
        />
      )
    case 'part':
    case 'blocks':
      return (
        <Inspector
          selection={selection as InspectorPart}
          crumbs={crumbs}
          title={title}
          design={design}
          update={update}
          gates={gates}
          locale={locale}
        />
      )
    case 'page':
    case 'element':
      return (
        <PagePanel
          crumbs={crumbs}
          title={title}
          page={page}
          design={design}
          update={update}
          nodes={nodes}
          onSelect={onSelect}
          onTheme={(more) => onTheme(more)}
        />
      )
  }
}
