'use client'

import { useState } from 'react'
import { Link, useRouter, useRouterState, useRouteContext } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/ui/avatar'
import { LogOut, Settings, Shield } from 'lucide-react'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import { getUserRoleAction } from '@/lib/actions/user'

type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

interface PortalHeaderProps {
  orgName: string
  orgLogo?: string | null
  /** Custom horizontal header logo (used when headerDisplayMode is 'custom_logo') */
  headerLogo?: string | null
  /** How the brand appears in the header */
  headerDisplayMode?: HeaderDisplayMode
  /** Custom display name shown in header (falls back to orgName when not provided) */
  headerDisplayName?: string | null
  /** User's role in the organization (passed from server) */
  userRole?: 'owner' | 'admin' | 'member' | 'user' | null
  /** Initial user data for SSR (store values override these after hydration) */
  initialUserData?: {
    name: string | null
    email: string | null
    avatarUrl: string | null
  }
}

const navItems = [
  { to: '/', label: 'Feedback' },
  { to: '/roadmap', label: 'Roadmap' },
]

export function PortalHeader({
  orgName,
  orgLogo,
  headerLogo,
  headerDisplayMode = 'logo_and_name',
  headerDisplayName,
  userRole,
  initialUserData: _initialUserData,
}: PortalHeaderProps) {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { session } = useRouteContext({ from: '__root__' })
  const authPopover = useAuthPopoverSafe()
  const openAuthPopover = authPopover?.openAuthPopover

  // Use custom display name if provided, otherwise fall back to org name
  const displayName = headerDisplayName || orgName

  // Client-side role state - fetched when session changes
  const [clientRole, setClientRole] = useState<'owner' | 'admin' | 'member' | 'user' | null>(null)
  const [isRoleFetched, setIsRoleFetched] = useState(false)

  // Fetch role when session changes
  const fetchRole = async () => {
    try {
      const result = await getUserRoleAction()
      if (result.success) {
        setClientRole(result.data.role)
      } else {
        setClientRole(null)
      }
      setIsRoleFetched(true)
    } catch {
      setClientRole(null)
      setIsRoleFetched(true)
    }
  }

  // Listen for auth success to refetch session and role
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate() // Refetch root loader (includes session)
      fetchRole()
    },
  })

  // Get user info from session
  const user = session?.user
  const isLoggedIn = !!user

  const name = user?.name ?? null
  const email = user?.email ?? null
  const avatarUrl = user?.image ?? null

  // Team members (owner, admin, member) can access admin dashboard
  // Use client role if fetched, otherwise fall back to server prop
  const effectiveRole = isRoleFetched ? clientRole : userRole
  const canAccessAdmin = isLoggedIn && ['owner', 'admin', 'member'].includes(effectiveRole || '')

  const handleSignOut = async () => {
    await signOut()
    setClientRole(null)
    setIsRoleFetched(true)
    router.invalidate() // Refetch session
    router.navigate({ to: '/' })
  }

  // Check if we're using the two-row layout (custom header logo)
  const useTwoRowLayout = headerDisplayMode === 'custom_logo' && headerLogo

  // Navigation component (reused in both layouts)
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

  // Auth/admin buttons component (reused in both layouts)
  const AuthButtons = () => (
    <div className="flex items-center">
      {/* Admin Button (visible for team members) */}
      {canAccessAdmin && (
        <Button variant="outline" size="sm" asChild className="mr-2">
          <Link to="/admin">
            <Shield className="mr-2 h-4 w-4" />
            Admin
          </Link>
        </Button>
      )}

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
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
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

  // Two-row layout for custom header logo
  if (useTwoRowLayout) {
    return (
      <div className="portal-header portal-header--two-row sticky top-0 z-50 w-full bg-[var(--header-background)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--header-background)]/60">
        {/* Main header with logo */}
        <header className="portal-header__main border-b border-[var(--header-border)]">
          <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <Link to="/" className="portal-header__logo flex items-center">
                <img src={headerLogo} alt={orgName} className="h-10 max-w-[240px] object-contain" />
              </Link>
              <AuthButtons />
            </div>
          </div>
        </header>
        {/* Navigation below header */}
        <nav className="portal-header__nav-row">
          <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8">
            <div className="flex items-center py-2">
              <Navigation />
            </div>
          </div>
        </nav>
      </div>
    )
  }

  // Single-row layout for logo_and_name or logo_only
  return (
    <header className="portal-header sticky top-0 z-50 w-full border-b border-[var(--header-border)] bg-[var(--header-background)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--header-background)]/60">
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 flex h-14 items-center">
        {/* Logo / Org Name */}
        <Link to="/" className="portal-header__logo flex items-center gap-2 mr-6">
          {orgLogo ? (
            <img
              src={orgLogo}
              alt={orgName}
              className="h-8 w-8 [border-radius:calc(var(--radius)*0.6)]"
            />
          ) : (
            <div className="h-8 w-8 [border-radius:calc(var(--radius)*0.6)] bg-primary flex items-center justify-center text-primary-foreground font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          {(headerDisplayMode === 'logo_and_name' || headerDisplayMode === 'custom_logo') && (
            <span className="portal-header__name font-semibold hidden sm:block max-w-[18ch] line-clamp-2 text-[var(--header-foreground)]">
              {displayName}
            </span>
          )}
        </Link>

        {/* Navigation Tabs */}
        <Navigation />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Auth/Admin Buttons */}
        <AuthButtons />
      </div>
    </header>
  )
}
