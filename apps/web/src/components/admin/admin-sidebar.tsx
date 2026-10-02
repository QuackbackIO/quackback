import { LaunchPlanDock } from '@/components/onboarding/launch-plan-dock'
import { useProductTour } from '@/components/onboarding/product-tour'
import { FormattedMessage } from 'react-intl'
import { railControlClass } from '@/components/admin/rail-item'
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import {
  ChatBubbleLeftIcon,
  MapIcon,
  UsersIcon,
  Cog6ToothIcon,
  Bars3Icon,
  GlobeAltIcon,
  DocumentTextIcon,
  BookOpenIcon,
  ChartBarIcon,
  QuestionMarkCircleIcon,
  HomeIcon,
  SignalIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signOut } from '@/lib/client/auth-client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { NotificationBell } from '@/components/notifications'
import { cn } from '@/lib/shared/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { LatestVersionResult } from '@/lib/server/functions/version'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'
import { setAgentAvailabilityFn } from '@/lib/server/functions/conversation'
import {
  listOwnerWorkspacesFn,
  openOwnerWorkspaceFn,
} from '@/lib/server/functions/owner-workspaces'
import { friendlySiblingAddress, WorkspaceSwitcher } from '@/components/admin/workspace-switcher'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { usePermissions } from '@/lib/client/use-permissions'
import {
  buildNavSections,
  canOpenSettings,
} from '@/components/admin/settings/settings-nav-sections'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags, type ProductId } from '@/lib/shared/types/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { ENTITY_ICONS } from '@/components/admin/entity-icon'
import {
  useBillingEnabled,
  useCloudEnabled,
  useSessionContext,
  useWorkspaceSettings,
} from '@/lib/client/hooks/use-root-context'

/** Availability toggle for the account menu (conversation routing). The label shows the
 *  state you'll switch to; the avatar dot shows the current one. */
function AvailabilityMenuItems({
  availability,
  onSet,
}: {
  availability: 'online' | 'away'
  onSet: (next: 'online' | 'away') => void
}) {
  const goingAway = availability === 'online'
  return (
    <DropdownMenuItem onClick={() => onSet(goingAway ? 'away' : 'online')}>
      {goingAway ? 'Set yourself as away' : 'Set yourself as active'}
    </DropdownMenuItem>
  )
}

interface AdminSidebarProps {
  initialUserData?: {
    name: string | null
    email: string | null
    avatarUrl: string | null
    chatAvailability?: 'online' | 'away'
  }
  latestVersion?: LatestVersionResult | null
}

interface RailItem {
  label: string
  href: string
  icon: typeof ChatBubbleLeftIcon
  /** Active on this path only, not on the pages under it. */
  exact?: boolean
  /** The workspace product this item belongs to; hidden while it is off. */
  product?: ProductId
}

// One product reads as one run: Feedback, Roadmap and Changelog sit together,
// then Support, Help Center and Status.
const RAIL_ITEMS: RailItem[] = [
  { label: 'Home', href: '/admin', icon: HomeIcon, exact: true },
  { label: 'Feedback', href: '/admin/feedback', icon: ENTITY_ICONS.post, product: 'feedback' },
  { label: 'Roadmap', href: '/admin/roadmap', icon: MapIcon, product: 'feedback' },
  {
    label: 'Changelog',
    href: '/admin/changelog',
    icon: ENTITY_ICONS.changelog,
    product: 'changelog',
  },
  // One Support entry covers conversations and tickets: the unified inbox
  // shell serves both (gated on either flag being on).
  { label: 'Support', href: '/admin/inbox', icon: ENTITY_ICONS.conversation, product: 'support' },
  {
    label: 'Help Center',
    href: '/admin/help-center',
    icon: ENTITY_ICONS.article,
    product: 'helpCenter',
  },
  { label: 'Status', href: '/admin/status', icon: SignalIcon, product: 'status' },
  { label: 'Analytics', href: '/admin/analytics', icon: ChartBarIcon },
  { label: 'Users', href: '/admin/users', icon: UsersIcon },
]

/** The rail items a viewer sees: the products that are on. */
export function buildRailItems(flags: Partial<FeatureFlags> | undefined): RailItem[] {
  return RAIL_ITEMS.filter((item) => !item.product || isProductEnabled(flags, item.product))
}

/**
 * A rail item is active on its page and every page under it, whatever the
 * search. The Link works that out itself and renders again only when it
 * changes, so a navigation renders the items it highlights or clears, and a
 * search-only one (opening a post or a conversation) none.
 */
const NAV_ACTIVE_OPTIONS = { includeSearch: false }
const NAV_EXACT_OPTIONS = { exact: true, includeSearch: false }

const railLinkProps = (exact: boolean) => ({
  activeOptions: exact ? NAV_EXACT_OPTIONS : NAV_ACTIVE_OPTIONS,
  activeProps: { className: railControlClass(true), 'data-active': 'true' },
  inactiveProps: { className: railControlClass() },
})

const MOBILE_LINK_CLASS =
  'flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors text-muted-foreground/80 hover:text-foreground hover:bg-muted/50'

function NavItem({
  href,
  icon: Icon,
  label,
  onClick,
  badge,
  badgeLabel,
  dot,
  exact = false,
}: {
  href: string
  icon: typeof ChatBubbleLeftIcon
  label: string
  onClick?: () => void
  /** Optional count or short mark (e.g. remaining launch steps) */
  badge?: string | number | null
  /** What the badge counts, read out in place of the bare number. */
  badgeLabel?: string
  /** Quiet marker while the plan is resolved but the first win is still open */
  dot?: boolean
  /** Active on this path only, not on the pages under it. */
  exact?: boolean
}) {
  return (
    <Link
      to={href}
      onClick={onClick}
      data-admin-rail-item=""
      data-tour={href === '/admin/roadmap' ? 'roadmap' : undefined}
      data-labeled=""
      {...railLinkProps(exact)}
    >
      <Icon className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge != null && badge !== '' && (
        <span className="ms-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
          <span aria-hidden="true">{badge}</span>
          <span className="sr-only">{badgeLabel ?? badge}</span>
        </span>
      )}
      {dot && (badge == null || badge === '') && (
        <span className="ms-auto size-2 rounded-full bg-primary" aria-hidden="true" />
      )}
    </Link>
  )
}

function MobileNavLink({
  href,
  icon: Icon,
  label,
  onClick,
  exact = false,
  badge,
  badgeLabel,
}: {
  href: string
  icon: typeof ChatBubbleLeftIcon
  label: string
  onClick: () => void
  exact?: boolean
  badge?: number | null
  badgeLabel?: string
}) {
  return (
    <Link
      to={href}
      onClick={onClick}
      activeOptions={exact ? NAV_EXACT_OPTIONS : NAV_ACTIVE_OPTIONS}
      activeProps={{ className: cn(MOBILE_LINK_CLASS, 'bg-muted/80 text-foreground font-medium') }}
      inactiveProps={{ className: MOBILE_LINK_CLASS }}
    >
      <Icon className="h-5 w-5" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
          <span aria-hidden="true">{badge}</span>
          <span className="sr-only">{badgeLabel ?? badge}</span>
        </span>
      ) : null}
    </Link>
  )
}

export function AdminSidebar({ initialUserData, latestVersion }: AdminSidebarProps) {
  const router = useRouter()
  const onNotificationsPage = useRouterState({
    select: (s) => s.location.pathname.startsWith('/admin/notifications'),
  })
  // Each part is selected: the route context is a new object after every
  // navigation, while these stay the same until the viewer or workspace changes.
  const tour = useProductTour()
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  const billingEnabled = useBillingEnabled()
  const cloudEnabled = useCloudEnabled()
  const permissions = usePermissions()

  const flags = settings?.featureFlags as FeatureFlags | undefined
  // Settings is offered to anyone who can open at least one of its pages; the
  // rest would only reach an access-denied page.
  const showSettings = useMemo(
    () =>
      canOpenSettings(buildNavSections(flags, Boolean(billingEnabled), cloudEnabled), permissions),
    [flags, billingEnabled, cloudEnabled, permissions]
  )
  // The org's own logo (resolved in brandingData by the root loader, same source
  // PortalBrandMark uses); fall back to the Quackback mark when none is set.
  const branding = (settings as { brandingData?: SettingsBrandingData } | undefined)?.brandingData
  const orgLogo = branding?.logoUrl ?? branding?.headerLogoUrl ?? '/logo.png'
  const orgName = branding?.name ?? 'Quackback'

  const railItems = buildRailItems(flags)
  // Posts and comments waiting for review. Shown on Feedback when there are any.
  const feedbackEnabled = isProductEnabled(flags, 'feedback')
  const canReviewPosts = usePermission(PERMISSIONS.POST_APPROVE)
  const reviewEnabled = feedbackEnabled && canReviewPosts
  const { data: moderation } = useQuery({
    ...adminQueries.moderationStatus(),
    enabled: reviewEnabled,
  })
  const pendingModeration = reviewEnabled ? (moderation?.pendingCount ?? 0) : 0
  const itemBadge = (item: RailItem) =>
    item.href === '/admin/feedback' && pendingModeration > 0 ? pendingModeration : null
  const itemBadgeLabel = (item: RailItem) =>
    itemBadge(item) ? `${pendingModeration} waiting for review` : undefined
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const user = session?.user
  const name = user?.name ?? initialUserData?.name ?? null
  const email = user?.email ?? initialUserData?.email ?? null
  const avatarUrl = user?.image ?? initialUserData?.avatarUrl ?? null

  // Agent conversation availability (only meaningful when the support inbox is enabled).
  const conversationsEnabled = flags?.supportInbox ?? false
  const [availability, setAvailability] = useState<'online' | 'away'>(
    initialUserData?.chatAvailability ?? 'online'
  )
  const availabilityMutation = useMutation({
    mutationFn: (next: 'online' | 'away') =>
      setAgentAvailabilityFn({ data: { availability: next } }),
  })
  const setAvail = (next: 'online' | 'away') => {
    const prev = availability
    setAvailability(next) // optimistic
    availabilityMutation.mutate(next, { onError: () => setAvailability(prev) })
  }

  const handleSignOut = async () => {
    await signOut()
    router.invalidate()
    window.location.href = '/'
  }

  const siblingsQuery = useQuery({
    queryKey: ['admin', 'owner-workspaces'],
    queryFn: () => listOwnerWorkspacesFn(),
    enabled: Boolean(billingEnabled),
  })
  const siblings = siblingsQuery.data ?? []

  const openSibling = useMutation({
    mutationFn: (instanceId: string) => openOwnerWorkspaceFn({ data: { instanceId } }),
    onSuccess: ({ url }) => {
      window.location.assign(url)
    },
  })

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        data-admin-rail=""
        data-labeled=""
        className="hidden w-56 shrink-0 flex-col border-chrome-hairline bg-chrome [--card:var(--chrome-background)] sm:flex"
      >
        <ScrollArea className="h-full" scrollBarClassName="w-2" type="auto">
          <div className="flex h-full min-h-screen flex-col py-2">
            {/* Logo */}
            <Link
              to="/admin"
              className="mb-4 flex items-center gap-2.5 px-4 opacity-90 transition-opacity hover:opacity-100"
            >
              <img
                src={orgLogo}
                alt={orgName}
                width={28}
                height={28}
                className="h-7 w-7 rounded object-contain"
              />
              <span className="truncate text-sm font-semibold">{orgName}</span>
            </Link>

            {/* Main Navigation */}
            <nav data-tour="products" className="flex flex-col gap-0.5 px-2">
              {railItems.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  exact={item.exact}
                  badge={itemBadge(item)}
                  badgeLabel={itemBadgeLabel(item)}
                />
              ))}
            </nav>

            {/* Spacer */}
            <div className="min-h-3 flex-1" />

            {/* Bottom Section */}
            <div className="flex flex-col gap-0.5 px-2">
              <LaunchPlanDock />
              {/* Settings (admin-only) */}
              {showSettings && (
                <NavItem href="/admin/settings" icon={Cog6ToothIcon} label="Settings" />
              )}

              {billingEnabled && siblings.length > 0 ? (
                <WorkspaceSwitcher siblings={siblings} onOpen={(id) => openSibling.mutate(id)} />
              ) : null}

              {/* Notifications */}
              <NotificationBell labeled active={onNotificationsPage} />

              {/* Portal Link */}
              <Link
                to="/"
                data-tour="view-portal"
                data-admin-rail-item=""
                className={railControlClass()}
              >
                <GlobeAltIcon className="size-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">View portal</span>
              </Link>

              {/* Help Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button data-admin-rail-item="" className={railControlClass()}>
                    <QuestionMarkCircleIcon className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">Help</span>
                    {latestVersion && (
                      <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-52">
                  <DropdownMenuItem onClick={() => tour?.start()}>
                    <FormattedMessage
                      id="onboarding.tour.replay"
                      defaultMessage="Replay the tour"
                    />
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href="https://www.quackback.io/docs/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <BookOpenIcon className="mr-2 h-4 w-4" />
                      Documentation
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href="https://feedback.quackback.io/changelog"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <DocumentTextIcon className="mr-2 h-4 w-4" />
                      Changelog
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground/60">v{__APP_VERSION__}</span>
                    {latestVersion && (
                      <a
                        href={latestVersion.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        Update available · v{latestVersion.version}
                      </a>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button data-admin-rail-item="" className={railControlClass()}>
                    <span className="relative shrink-0">
                      <Avatar className="size-6" src={avatarUrl} name={name} />
                      {conversationsEnabled && (
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background',
                            availability === 'online'
                              ? 'bg-green-500'
                              : 'border-2 border-muted-foreground bg-background'
                          )}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{name || 'Account'}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8 shrink-0" src={avatarUrl} name={name} />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-sm font-medium truncate">{name}</p>
                        <p className="text-xs text-muted-foreground truncate">{email}</p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {conversationsEnabled && (
                    <AvailabilityMenuItems availability={availability} onSet={setAvail} />
                  )}
                  <DropdownMenuItem asChild>
                    <Link to="/settings">Settings</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </ScrollArea>
      </aside>

      {/* Mobile Header */}
      <header className="sm:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between h-14 px-4 border-b border-border/60 bg-card/95 backdrop-blur-sm">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Open menu">
              <Bars3Icon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="px-5 pt-6 pb-4">
              <SheetTitle className="flex items-center gap-3">
                <Link to="/admin" onClick={() => setMobileMenuOpen(false)}>
                  <img
                    src={orgLogo}
                    alt={orgName}
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded object-contain"
                  />
                </Link>
                <span className="text-base font-semibold">{orgName}</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1.5 px-4 py-3">
              {railItems.map((item) => (
                <MobileNavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  exact={item.exact}
                  badge={itemBadge(item)}
                  badgeLabel={itemBadgeLabel(item)}
                  onClick={() => setMobileMenuOpen(false)}
                />
              ))}
              <div className="h-px bg-border/40 my-4" />
              {showSettings && (
                <MobileNavLink
                  href="/admin/settings"
                  icon={Cog6ToothIcon}
                  label="Settings"
                  onClick={() => setMobileMenuOpen(false)}
                />
              )}
              {billingEnabled && siblings.length > 0
                ? siblings.map((sibling) => (
                    <button
                      key={sibling.instanceId}
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false)
                        openSibling.mutate(sibling.instanceId)
                      }}
                      className="flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg text-sm text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <span>{sibling.displayName}</span>
                      {friendlySiblingAddress(sibling.url) ? (
                        <span className="text-[11px]">{friendlySiblingAddress(sibling.url)}</span>
                      ) : null}
                    </button>
                  ))
                : null}
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <GlobeAltIcon className="h-5 w-5" />
                View portal
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false)
                  tour?.start()
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-muted-foreground"
              >
                <QuestionMarkCircleIcon className="h-5 w-5" />
                <FormattedMessage id="onboarding.tour.replay" defaultMessage="Replay the tour" />
              </button>
              <div className="h-px bg-border/40 my-4" />
              <a
                href="https://www.quackback.io/docs/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <BookOpenIcon className="h-5 w-5" />
                Documentation
              </a>
              <a
                href="https://feedback.quackback.io/changelog"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <DocumentTextIcon className="h-5 w-5" />
                Changelog
              </a>
              <div className="px-4 py-2 flex flex-col gap-1">
                <span className="text-xs text-muted-foreground/50">v{__APP_VERSION__}</span>
                {latestVersion && (
                  <a
                    href={latestVersion.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Update available · v{latestVersion.version}
                  </a>
                )}
              </div>
            </nav>
          </SheetContent>
        </Sheet>

        <Link to="/admin" className="absolute left-1/2 -translate-x-1/2">
          <img
            src={orgLogo}
            alt={orgName}
            width={28}
            height={28}
            className="h-7 w-7 rounded object-contain"
          />
        </Link>

        <div className="flex items-center gap-1">
          <NotificationBell className="h-9 w-9" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative h-9 w-9 rounded-full flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-8 w-8" src={avatarUrl} name={name} />
                {conversationsEnabled && (
                  <span
                    className={cn(
                      'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-background',
                      availability === 'online'
                        ? 'bg-green-500'
                        : 'border-2 border-muted-foreground bg-background'
                    )}
                    aria-hidden="true"
                  />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0" src={avatarUrl} name={name} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">{email}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {conversationsEnabled && (
                <AvailabilityMenuItems availability={availability} onSet={setAvail} />
              )}
              <DropdownMenuItem asChild>
                <Link to="/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  )
}
