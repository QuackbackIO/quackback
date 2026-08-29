import { useMemo, useState, type ComponentType } from 'react'
import { Link, useRouterState, useRouteContext } from '@tanstack/react-router'
import {
  Cog6ToothIcon,
  UsersIcon,
  UserGroupIcon,
  Squares2X2Icon,
  PuzzlePieceIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleLeftIcon,
  ClockIcon,
  CommandLineIcon,
  ShieldCheckIcon,
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
  BellIcon,
  BuildingOfficeIcon,
  CreditCardIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/solid'
import { GitHubIcon } from '@/components/icons/integration-icons'
import { cn } from '@/lib/shared/utils'
import { NAV_ICON_CLASS, NAV_ITEM_CLASS, NAV_SECTION_CLASS } from '@/components/shared/nav-tokens'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'

interface NavItem {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  /** Highlight only on this path, not nested child pages. */
  exact?: boolean
}

/** A product accordion inside the Products section (Feedback & Roadmaps, Support, ...). */
interface NavGroup {
  label: string
  icon: ComponentType<{ className?: string }>
  /** When set, the group label is also a page (Channels hub). */
  to?: string
  kids: NavEntry[]
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
 * does not reflow when a flag flips. AI & Automation lives outside settings
 * entirely, as its own main-nav area at /admin/automation (M5).
 *
 * @param billingEnabled Whether this workspace has a valid billing projection
 *   configured. Not a feature flag — a flag answers "has the admin turned it
 *   on", and this answers "does this deployment sell anything". False on
 *   every self-hosted install, which is why the Billing row is absent there.
 */
export function buildNavSections(
  flags?: Partial<FeatureFlags>,
  billingEnabled = false,
  cloudEnabled = false
): NavSection[] {
  const products: NavEntry[] = []

  products.push({
    label: 'Feedback & Roadmaps',
    icon: ChatBubbleLeftIcon,
    kids: [
      { label: 'Boards', to: '/admin/settings/boards', icon: Squares2X2Icon },
      { label: 'Statuses', to: '/admin/settings/statuses', icon: Cog6ToothIcon },
      { label: 'Tags', to: '/admin/settings/tags', icon: TagIcon },
      { label: 'Moderation', to: '/admin/settings/moderation', icon: ShieldCheckIcon },
    ],
  })

  const channelPages: NavItem[] = [
    ...(flags?.supportInbox
      ? [
          {
            label: 'Messenger',
            to: '/admin/settings/channels/messenger',
            icon: ChatBubbleLeftRightIcon,
          },
        ]
      : []),
    ...(isProductEnabled(flags, 'support')
      ? [
          { label: 'Email', to: '/admin/settings/channels/email', icon: EnvelopeIcon },
          { label: 'GitHub', to: '/admin/settings/channels/github', icon: GitHubIcon },
        ]
      : []),
  ]
  const supportKids: NavEntry[] = [
    ...(flags?.supportInbox
      ? [
          {
            label: 'Channels',
            to: '/admin/settings/channels',
            icon: ChatBubbleLeftRightIcon,
            kids: channelPages,
          } satisfies NavGroup,
        ]
      : channelPages),
    ...(isProductEnabled(flags, 'support')
      ? [
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
  if (isProductEnabled(flags, 'support')) {
    products.push({ label: 'Support', icon: ChatBubbleLeftRightIcon, kids: supportKids })
  }

  if (isProductEnabled(flags, 'helpCenter')) {
    products.push({
      label: 'Help Center',
      to: '/admin/settings/help-center',
      icon: BookOpenIcon,
    })
  }

  if (isProductEnabled(flags, 'changelog')) {
    products.push({
      label: 'Changelog',
      to: '/admin/settings/changelog',
      icon: MegaphoneIcon,
    })
  }

  if (isProductEnabled(flags, 'status')) {
    products.push({
      label: 'Status',
      to: '/admin/settings/status',
      icon: SignalIcon,
    })
  }

  return [
    { label: 'Products', items: products },
    {
      label: 'Workspace',
      items: [
        { label: 'General', to: '/admin/settings/general', icon: Cog6ToothIcon },
        ...(cloudEnabled
          ? [{ label: 'Domains', to: '/admin/settings/domains', icon: GlobeAltIcon }]
          : []),
        { label: 'Notifications', to: '/admin/settings/notifications', icon: BellIcon },
        { label: 'Portal', to: '/admin/settings/portal', icon: GlobeAltIcon },
        { label: 'Widget', to: '/admin/settings/widget', icon: ChatBubbleLeftRightIcon },
        { label: 'Members & Teams', to: '/admin/settings/members', icon: UsersIcon },
        {
          label: 'Access & Security',
          to: '/admin/settings/security/authentication',
          icon: ShieldCheckIcon,
        },
        { label: 'Developers', to: '/admin/settings/developers', icon: CommandLineIcon },
        { label: 'Integrations', to: '/admin/settings/integrations', icon: PuzzlePieceIcon },
        ...(billingEnabled
          ? [{ label: 'Plan & billing', to: '/admin/settings/billing', icon: CreditCardIcon }]
          : []),
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'People', to: '/admin/settings/people', icon: UserGroupIcon },
        { label: 'Companies', to: '/admin/settings/companies', icon: BuildingOfficeIcon },
        ...(isProductEnabled(flags, 'support')
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
  const { settings, billingEnabled, cloudEnabled } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined

  const navSections = useMemo(
    () => buildNavSections(flags, billingEnabled, cloudEnabled),
    [flags, billingEnabled, cloudEnabled]
  )

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

function entryIsInPath(entry: NavEntry, pathname: string): boolean {
  if (isNavGroup(entry)) {
    if (entry.to && (pathname === entry.to || pathname.startsWith(`${entry.to}/`))) return true
    return entry.kids.some((kid) => entryIsInPath(kid, pathname))
  }
  return pathname === entry.to || pathname.startsWith(`${entry.to}/`)
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
  const hasActiveKid = group.kids.some((kid) => entryIsInPath(kid, pathname))
  const groupPageActive = !!group.to && pathname === group.to
  const inGroup = groupPageActive || hasActiveKid
  // Groups with the active page start open; others start collapsed to keep
  // the Products section scannable. A linked group (Channels) always shows
  // its child pages — those are breadcrumb children, not a second accordion.
  const [open, setOpen] = useState(inGroup)
  const showKids = !!group.to || open
  const Icon = group.icon

  return (
    <div>
      {group.to ? (
        <NavLink
          item={{ label: group.label, to: group.to, icon: group.icon, exact: true }}
          pathname={pathname}
          tabbable={parentOpen}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          tabIndex={parentOpen ? undefined : -1}
          className={cn(
            NAV_ITEM_CLASS,
            'w-full font-medium',
            inGroup ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className={cn(NAV_ICON_CLASS, inGroup && 'text-primary')} />
          <span className="truncate flex-1 text-left">{group.label}</span>
          <ChevronDownIcon
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out',
              !open && '-rotate-90'
            )}
          />
        </button>
      )}
      {showKids && (
        <div className="ml-4 border-l border-border/50 pl-1.5 space-y-0.5">
          {group.kids.map((kid) =>
            isNavGroup(kid) ? (
              <NavGroupRows
                key={kid.label}
                group={kid}
                pathname={pathname}
                parentOpen={parentOpen}
              />
            ) : (
              <NavLink key={kid.to} item={kid} pathname={pathname} tabbable={parentOpen} />
            )
          )}
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
  const isActive = pathname === item.to || (!item.exact && pathname.startsWith(`${item.to}/`))
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
