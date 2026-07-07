import { useMemo, useState } from 'react'
import { Link, useRouterState, useRouteContext } from '@tanstack/react-router'
import {
  Cog6ToothIcon,
  UsersIcon,
  UserGroupIcon,
  Squares2X2Icon,
  PaintBrushIcon,
  PuzzlePieceIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleLeftIcon,
  ClockIcon,
  CommandLineIcon,
  ShieldCheckIcon,
  BeakerIcon,
  BookOpenIcon,
  TagIcon,
  MegaphoneIcon,
  TicketIcon,
  QueueListIcon,
  EnvelopeIcon,
  DocumentDuplicateIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  SignalIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { NAV_ICON_CLASS, NAV_ITEM_CLASS, NAV_SECTION_CLASS } from '@/components/shared/nav-tokens'
import type { FeatureFlags } from '@/lib/shared/types'

interface NavItem {
  label: string
  to: string
  icon: typeof Cog6ToothIcon
}

/** A product accordion inside the Products section (Feedback, Support, ...). */
interface NavGroup {
  label: string
  icon: typeof Cog6ToothIcon
  kids: NavItem[]
}

type NavEntry = NavItem | NavGroup

interface NavSection {
  label: string
  items: NavEntry[]
}

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'kids' in entry
}

/**
 * The settings IA (SETTINGS-IA-SPEC Option B): three stable sections. Flags hide
 * ITEMS (or whole product accordions), never sections, so the sidebar layout
 * does not reflow when a flag flips - Products always renders because Feedback
 * is always on. AI & Automation lives outside settings entirely, as its own
 * main-nav area at /admin/automation (M5).
 */
export function buildNavSections(flags?: {
  helpCenter?: boolean
  supportInbox?: boolean
  supportTickets?: boolean
  statusPage?: boolean
}): NavSection[] {
  const products: NavEntry[] = [
    {
      label: 'Feedback',
      icon: ChatBubbleLeftIcon,
      kids: [
        { label: 'Boards', to: '/admin/settings/boards', icon: Squares2X2Icon },
        { label: 'Statuses', to: '/admin/settings/statuses', icon: Cog6ToothIcon },
        { label: 'Tags', to: '/admin/settings/tags', icon: TagIcon },
        { label: 'Moderation', to: '/admin/settings/moderation', icon: ShieldCheckIcon },
      ],
    },
  ]

  const supportKids: NavItem[] = [
    ...(flags?.supportInbox
      ? [
          {
            label: 'Messenger',
            to: '/admin/settings/conversations',
            icon: ChatBubbleLeftRightIcon,
          },
          { label: 'Macros', to: '/admin/settings/macros', icon: DocumentDuplicateIcon },
          { label: 'Office Hours', to: '/admin/settings/office-hours', icon: ClockIcon },
          { label: 'SLA policies', to: '/admin/settings/sla', icon: ShieldCheckIcon },
        ]
      : []),
    ...(flags?.supportTickets
      ? [
          { label: 'Ticket types', to: '/admin/settings/ticket-types', icon: TicketIcon },
          {
            label: 'Ticket statuses & stages',
            to: '/admin/settings/ticket-statuses',
            icon: QueueListIcon,
          },
        ]
      : []),
  ]
  if (supportKids.length > 0) {
    products.push({ label: 'Support', icon: ChatBubbleLeftRightIcon, kids: supportKids })
  }

  if (flags?.helpCenter) {
    products.push({
      label: 'Help Center',
      icon: BookOpenIcon,
      kids: [{ label: 'Settings', to: '/admin/settings/help-center', icon: BookOpenIcon }],
    })
  }

  // Changelog is a core product (no flag).
  products.push({
    label: 'Changelog',
    icon: MegaphoneIcon,
    kids: [{ label: 'Settings', to: '/admin/settings/changelog', icon: MegaphoneIcon }],
  })

  if (flags?.statusPage) {
    products.push({
      label: 'Status',
      icon: SignalIcon,
      kids: [{ label: 'Settings', to: '/admin/settings/status', icon: SignalIcon }],
    })
  }

  return [
    { label: 'Products', items: products },
    {
      label: 'Workspace',
      items: [
        { label: 'General', to: '/admin/settings/general', icon: Cog6ToothIcon },
        { label: 'Branding', to: '/admin/settings/branding', icon: PaintBrushIcon },
        { label: 'Portal', to: '/admin/settings/portal', icon: MegaphoneIcon },
        { label: 'Widget', to: '/admin/settings/widget', icon: ChatBubbleLeftRightIcon },
        { label: 'Members & Teams', to: '/admin/settings/members', icon: UsersIcon },
        {
          label: 'Access & Security',
          to: '/admin/settings/security/authentication',
          icon: ShieldCheckIcon,
        },
        ...(flags?.supportInbox
          ? [{ label: 'Emails', to: '/admin/settings/channels', icon: EnvelopeIcon }]
          : []),
        { label: 'Developers', to: '/admin/settings/developers', icon: CommandLineIcon },
        { label: 'Integrations', to: '/admin/settings/integrations', icon: PuzzlePieceIcon },
        { label: 'Labs', to: '/admin/settings/labs', icon: BeakerIcon },
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'People', to: '/admin/settings/people', icon: UserGroupIcon },
        ...(flags?.supportInbox
          ? [
              {
                label: 'Conversations',
                to: '/admin/settings/conversation-data',
                icon: ChatBubbleLeftIcon,
              },
            ]
          : []),
        { label: 'Imports & exports', to: '/admin/settings/imports', icon: ArrowDownTrayIcon },
      ],
    },
  ]
}

export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined

  const navSections = useMemo(() => buildNavSections(flags), [flags])

  return (
    <div className="space-y-2">
      {navSections.map((section) => (
        <NavCard key={section.label} section={section} pathname={pathname} />
      ))}
    </div>
  )
}

/**
 * A settings section rendered as a collapsible card. The gradient/border frames
 * each group, and the body animates open/closed via a grid-rows 1fr↔0fr height
 * transition (no JS measuring). Sections start open, matching the prior nav.
 */
function NavCard({ section, pathname }: { section: NavSection; pathname: string }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/20 bg-gradient-to-b from-foreground/[0.04] to-transparent">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <span className={NAV_SECTION_CLASS}>{section.label}</span>
        <ChevronDownIcon
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-300 ease-out',
            !open && '-rotate-90'
          )}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 px-1.5 pb-2">
            {section.items.map((entry) =>
              isNavGroup(entry) ? (
                <NavGroupRows
                  key={entry.label}
                  group={entry}
                  pathname={pathname}
                  parentOpen={open}
                />
              ) : (
                <NavLink key={entry.to} item={entry} pathname={pathname} tabbable={open} />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A product accordion: a toggle row plus its indented child links. */
function NavGroupRows({
  group,
  pathname,
  parentOpen,
}: {
  group: NavGroup
  pathname: string
  parentOpen: boolean
}) {
  const hasActiveKid = group.kids.some(
    (kid) => pathname === kid.to || pathname.startsWith(kid.to + '/')
  )
  // Groups with the active page start open; others start collapsed to keep
  // the Products section scannable.
  const [open, setOpen] = useState(hasActiveKid)
  const Icon = group.icon

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        tabIndex={parentOpen ? undefined : -1}
        className={cn(
          NAV_ITEM_CLASS,
          'w-full font-medium',
          hasActiveKid ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Icon className={cn(NAV_ICON_CLASS, hasActiveKid && 'text-primary')} />
        <span className="truncate flex-1 text-left">{group.label}</span>
        <ChevronDownIcon
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out',
            !open && '-rotate-90'
          )}
        />
      </button>
      {open && (
        <div className="ml-4 border-l border-border/50 pl-1.5 space-y-0.5">
          {group.kids.map((kid) => (
            <NavLink key={kid.to} item={kid} pathname={pathname} tabbable={parentOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

function NavLink({
  item,
  pathname,
  tabbable,
}: {
  item: NavItem
  pathname: string
  tabbable: boolean
}) {
  const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
  const Icon = item.icon

  return (
    <Link
      to={item.to}
      tabIndex={tabbable ? undefined : -1}
      className={cn(
        NAV_ITEM_CLASS,
        isActive
          ? 'bg-primary/10 text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
      )}
    >
      <Icon className={cn(NAV_ICON_CLASS, isActive && 'text-primary')} />
      <span className="truncate flex-1">{item.label}</span>
    </Link>
  )
}
