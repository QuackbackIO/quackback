import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useRouter, useRouterState, useRouteContext } from '@tanstack/react-router'
import {
  ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon,
  MapIcon,
  Cog6ToothIcon,
  Bars3Icon,
  GlobeAltIcon,
  DocumentTextIcon,
  BookOpenIcon,
  ChartBarIcon,
  QuestionMarkCircleIcon,
  TicketIcon,
  BuildingOffice2Icon,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { signOut } from '@/lib/client/auth-client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { NotificationBell } from '@/components/notifications'
import { cn } from '@/lib/shared/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { LatestVersionResult } from '@/lib/server/functions/version'
import { useMyPermissions } from '@/lib/client/hooks/use-authz-queries'
import { PERMISSIONS, type PermissionKey } from '@/lib/server/domains/authz'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'
import { setAgentAvailabilityFn } from '@/lib/server/functions/chat'

/** Availability toggle for the account menu (chat routing). The label shows the
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

interface NavItemDef {
  label: string
  href: string
  icon: typeof ChatBubbleLeftIcon
  /** Optional permission gate; nav entry is hidden when actor lacks the permission. */
  requiresPermission?: PermissionKey
}

const navItems: NavItemDef[] = [
  { label: 'Feedback', href: '/admin/feedback', icon: ChatBubbleLeftIcon },
  {
    label: 'Tickets',
    href: '/admin/tickets',
    icon: TicketIcon,
    requiresPermission: PERMISSIONS.TICKET_VIEW_ALL,
  },
  { label: 'Customers', href: '/admin/customers', icon: BuildingOffice2Icon },
  { label: 'Conversations', href: '/admin/inbox', icon: ChatBubbleLeftRightIcon },
  { label: 'Roadmap', href: '/admin/roadmap', icon: MapIcon },
  { label: 'Changelog', href: '/admin/changelog', icon: DocumentTextIcon },
  { label: 'Help Center', href: '/admin/help-center', icon: BookOpenIcon },
  { label: 'Analytics', href: '/admin/analytics', icon: ChartBarIcon },
]

function isNavActive(pathname: string, href: string) {
  if (href === '/admin/customers') {
    return (
      pathname === href ||
      pathname.startsWith('/admin/customers/') ||
      pathname.startsWith('/admin/contacts/') ||
      pathname === '/admin/contacts' ||
      pathname === '/admin/users'
    )
  }
  return pathname === href || pathname.startsWith(href + '/')
}

function NavItem({
  href,
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  href: string
  icon: typeof ChatBubbleLeftIcon
  label: string
  isActive: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={href}
          onClick={onClick}
          className={cn(
            'relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200',
            'text-muted-foreground/70 hover:text-foreground hover:bg-muted/50',
            isActive && 'bg-muted/80 text-foreground'
          )}
        >
          <Icon className="h-5 w-5" />
          <span className="sr-only">{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function AdminSidebar({ initialUserData, latestVersion }: AdminSidebarProps) {
  const router = useRouter()
  const { session, settings, userRole } = useRouteContext({ from: '__root__' })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The settings area is admin-only (every tab gates on requireAuth(['admin'])).
  // Members would only ever land on the access-denied page, so hide the cog.
  const isAdmin = userRole === 'admin'
  const flags = settings?.featureFlags as
    | { helpCenter?: boolean; supportInbox?: boolean }
    | undefined
  const { data: myPerms } = useMyPermissions()
  // The org's own logo (resolved in brandingData by the root loader, same source
  // PortalBrandMark uses); fall back to the Quackback mark when none is set.
  const branding = (settings as { brandingData?: SettingsBrandingData } | undefined)?.brandingData
  const orgLogo = branding?.logoUrl ?? branding?.headerLogoUrl ?? '/logo.png'
  const orgName = branding?.name ?? 'Quackback'

  const filteredNavItems = navItems.filter((item) => {
    if (item.href === '/admin/help-center') return flags?.helpCenter ?? false
    if (item.href === '/admin/inbox') return flags?.supportInbox ?? false
    if (item.requiresPermission) {
      if (!myPerms) return false
      const ws = myPerms.workspacePermissions.includes(item.requiresPermission)
      const team = myPerms.teamPermissions.some((t) =>
        t.permissions.includes(item.requiresPermission!)
      )
      return ws || team
    }
    return true
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const user = session?.user
  const name = user?.name ?? initialUserData?.name ?? null
  const email = user?.email ?? initialUserData?.email ?? null
  const avatarUrl = user?.image ?? initialUserData?.avatarUrl ?? null

  // Agent chat availability (only meaningful when the support inbox is enabled).
  const chatEnabled = flags?.supportInbox ?? false
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

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden sm:flex w-18 shrink-0 flex-col">
        <ScrollArea className="h-full" scrollBarClassName="w-2" type="always">
          <div className="flex flex-col h-full min-h-screen py-6">
            {/* Logo */}
            <Link
              to="/admin/feedback"
              className="flex items-center justify-center mb-8 opacity-90 hover:opacity-100 transition-opacity"
            >
              <img
                src={orgLogo}
                alt={orgName}
                width={28}
                height={28}
                className="h-7 w-7 rounded object-contain"
              />
            </Link>

            {/* Main Navigation */}
            <nav className="flex flex-col items-center gap-3">
              {filteredNavItems.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={isNavActive(pathname, item.href)}
                />
              ))}
            </nav>

            {/* Spacer */}
            <div className="flex-1 min-h-12" />

            {/* Bottom Section */}
            <div className="flex flex-col items-center gap-3">
              {/* Settings (admin-only) */}
              {isAdmin && (
                <NavItem
                  href="/admin/settings"
                  icon={Cog6ToothIcon}
                  label="Settings"
                  isActive={isNavActive(pathname, '/admin/settings')}
                />
              )}

              {/* Notifications */}
              <NotificationBell />

              {/* Portal Link */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/"
                    className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
                  >
                    <GlobeAltIcon className="h-5 w-5" />
                    <span className="sr-only">View Portal</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  View Portal
                </TooltipContent>
              </Tooltip>

              {/* Help Menu */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button className="relative flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <QuestionMarkCircleIcon className="h-5 w-5" />
                        {latestVersion && (
                          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
                        )}
                        <span className="sr-only">Help</span>
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Help
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-52">
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button className="relative flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Avatar className="h-9 w-9" src={avatarUrl} name={name} />
                        {chatEnabled && (
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
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Account
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8 shrink-0" src={avatarUrl} name={name} />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-sm font-medium truncate">{name}</p>
                        <p className="text-xs text-muted-foreground truncate">{email}</p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {chatEnabled && (
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
                <Link to="/admin/feedback" onClick={() => setMobileMenuOpen(false)}>
                  <img
                    src={orgLogo}
                    alt={orgName}
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded object-contain"
                  />
                </Link>
                <span className="text-base font-semibold">Quackback</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1.5 px-4 py-3">
              {filteredNavItems.map((item) => {
                const isActive = isNavActive(pathname, item.href)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors',
                      'text-muted-foreground/80 hover:text-foreground hover:bg-muted/50',
                      isActive && 'bg-muted/80 text-foreground font-medium'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                )
              })}
              <div className="h-px bg-border/40 my-4" />
              {isAdmin && (
                <Link
                  to="/admin/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors',
                    'text-muted-foreground/80 hover:text-foreground hover:bg-muted/50',
                    isNavActive(pathname, '/admin/settings') &&
                      'bg-muted/80 text-foreground font-medium'
                  )}
                >
                  <Cog6ToothIcon className="h-5 w-5" />
                  Settings
                </Link>
              )}
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <GlobeAltIcon className="h-5 w-5" />
                View Portal
              </Link>
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

        <Link to="/admin/feedback" className="absolute left-1/2 -translate-x-1/2">
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
                {chatEnabled && (
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
              <DropdownMenuLabel className="font-normal">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0" src={avatarUrl} name={name} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">{email}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {chatEnabled && (
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
