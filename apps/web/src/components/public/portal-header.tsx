import { useEffect, useState } from 'react'
import { Link, useRouter, useRouterState, useRouteContext } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/shared/utils'
import { isTeamMember } from '@/lib/shared/roles'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/server/auth/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/ui/avatar'
import {
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
} from '@heroicons/react/24/solid'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { NotificationBell } from '@/components/notifications'

interface PortalHeaderProps {
  orgName: string
  orgLogo?: string | null
  /** User's role in the organization (passed from server) */
  userRole?: 'admin' | 'member' | 'user' | null
  /** Initial user data for SSR (store values override these after hydration) */
  initialUserData?: {
    name: string | null
    email: string | null
    avatarUrl: string | null
  }
  /** Whether to show the theme toggle (hidden when admin forces a specific theme) */
  showThemeToggle?: boolean
}

const navItems = [
  { to: '/', label: 'Feedback' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/changelog', label: 'Changelog' },
]

export function PortalHeader({
  orgName,
  orgLogo,
  userRole,
  initialUserData,
  showThemeToggle = true,
}: PortalHeaderProps) {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { session } = useRouteContext({ from: '__root__' })
  const authPopover = useAuthPopoverSafe()
  const openAuthPopover = authPopover?.openAuthPopover
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch for theme toggle
  useEffect(() => {
    setMounted(true)
  }, [])

  // Listen for auth success to refetch session and role via router invalidation
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate() // Refetch loaders (includes session and userRole)
    },
  })

  // Get user info from session
  const user = session?.user
  const isLoggedIn = !!user

  // Use initialUserData (which includes properly fetched avatar from blob storage)
  // falling back to session data
  const name = initialUserData?.name ?? user?.name ?? null
  const email = initialUserData?.email ?? user?.email ?? null
  const avatarUrl = initialUserData?.avatarUrl ?? user?.image ?? null

  // Team members (admin, member) can access admin dashboard
  const canAccessAdmin = isLoggedIn && isTeamMember(userRole)

  const handleSignOut = async () => {
    await signOut()
    router.invalidate() // Refetch session
    router.navigate({ to: '/' })
  }

  // Navigation component
  const Navigation = () => (
    <nav className="portal-nav flex items-center gap-1">
      {navItems.map((item) => {
        const isActive =
          item.to === '/'
            ? pathname === '/' || /^\/[^/]+\/posts\//.test(pathname)
            : pathname.startsWith(item.to)

        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              'portal-nav__item px-3 py-2 text-sm font-medium transition-colors [border-radius:calc(var(--radius)*0.8)]',
              isActive
                ? 'portal-nav__item--active bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)]'
                : 'text-[var(--nav-inactive-color)] hover:text-[var(--nav-active-foreground)] hover:bg-[var(--nav-active-background)]/50'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  // Compact theme toggle dropdown for the header
  const ThemeToggle = () => {
    if (!showThemeToggle || !mounted) return null

    const themeOptions = [
      { value: 'system', label: 'System', icon: ComputerDesktopIcon },
      { value: 'light', label: 'Light', icon: SunIcon },
      { value: 'dark', label: 'Dark', icon: MoonIcon },
    ] as const

    const currentTheme = themeOptions.find((t) => t.value === theme) ?? themeOptions[0]
    const CurrentIcon = currentTheme.icon

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <CurrentIcon className="h-4 w-4" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {themeOptions.map((t) => (
            <DropdownMenuItem
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={cn(theme === t.value && 'bg-accent')}
            >
              <t.icon className="mr-2 h-4 w-4" />
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Auth/admin buttons component (reused in both layouts)
  const AuthButtons = () => (
    <div className="flex items-center">
      {/* Theme Toggle (when admin allows user choice) */}
      <ThemeToggle />

      {/* Admin Button (visible for team members) */}
      {canAccessAdmin && (
        <Button variant="outline" size="sm" asChild className="ml-1 mr-2">
          <Link to="/admin">
            <ShieldCheckIcon className="mr-2 h-4 w-4" />
            Admin
          </Link>
        </Button>
      )}

      {/* Notification Bell (logged in users only) */}
      {isLoggedIn && <NotificationBell popoverSide="bottom" className="mr-1" />}

      {/* Auth Buttons */}
      {isLoggedIn ? (
        // Logged-in user - show user dropdown
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
              <Avatar className="h-9 w-9" src={avatarUrl} name={name} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">{email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Cog6ToothIcon className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut}>
              <ArrowRightStartOnRectangleIcon className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : openAuthPopover ? (
        // Anonymous user with auth popover available - show login/signup buttons
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => openAuthPopover({ mode: 'login' })}>
            Log in
          </Button>
          <Button size="sm" onClick={() => openAuthPopover({ mode: 'signup' })}>
            Sign up
          </Button>
        </div>
      ) : null}
    </div>
  )

  // Two-row layout: Logo + Auth on top, Navigation below
  return (
    <div className="portal-header w-full py-2 border-b border-[var(--header-border)] bg-[var(--header-background)]">
      {/* Row 1: Logo + Name + Auth */}
      <div>
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6">
          <div className="flex h-12 items-center justify-between">
            <Link to="/" className="portal-header__logo flex items-center gap-2">
              {orgLogo ? (
                <img
                  src={orgLogo}
                  alt={orgName}
                  className="h-8 w-8 [border-radius:calc(var(--radius)*0.6)]"
                />
              ) : (
                <div className="h-8 w-8 [border-radius:calc(var(--radius)*0.6)] bg-primary flex items-center justify-center text-primary-foreground font-semibold">
                  {orgName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="portal-header__name font-semibold hidden sm:block max-w-[18ch] line-clamp-2 text-[var(--header-foreground)]">
                {orgName}
              </span>
            </Link>
            <AuthButtons />
          </div>
        </div>
      </div>

      {/* Row 2: Navigation */}
      <div className="mt-2">
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6">
          <div className="flex items-center">
            <Navigation />
          </div>
        </div>
      </div>
    </div>
  )
}
