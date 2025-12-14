'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { signOut, useSession } from '@/lib/auth/client'
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
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'

interface PortalHeaderProps {
  orgName: string
  orgLogo?: string | null
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
  { href: '/', label: 'Feedback' },
  { href: '/roadmap', label: 'Roadmap' },
]

export function PortalHeader({ orgName, orgLogo, userRole, initialUserData }: PortalHeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { openAuthPopover } = useAuthPopover()

  // Track if we've completed initial hydration to prevent SSR/client mismatch
  const [isHydrated, setIsHydrated] = useState(false)
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Client-side session state - updates without page reload
  const { data: sessionData, isPending, refetch: refetchSession } = useSession()

  // Client-side role state - fetched when session changes
  const [clientRole, setClientRole] = useState<'owner' | 'admin' | 'member' | 'user' | null>(null)
  const [isRoleFetched, setIsRoleFetched] = useState(false)

  // Fetch role when session changes
  const fetchRole = async () => {
    try {
      const res = await fetch('/api/user/role')
      const data = await res.json()
      setClientRole(data.role)
      setIsRoleFetched(true)
    } catch {
      setClientRole(null)
      setIsRoleFetched(true)
    }
  }

  // Listen for auth success to refetch session and role
  useAuthBroadcast({
    onSuccess: () => {
      refetchSession()
      fetchRole()
    },
  })

  // Derive effective auth state from client session when available
  // During initial hydration (!isHydrated), ALWAYS use server props to match SSR output
  // After hydration, use client session once loaded
  const clientUser = sessionData?.user
  const isSessionLoaded = isHydrated && !isPending

  // Auth state: during hydration use server props, after use client session
  const isLoggedIn = isSessionLoaded ? !!clientUser : userRole !== null && userRole !== undefined

  // Use client session for name/email once loaded, otherwise fall back to server data
  const name =
    isSessionLoaded && clientUser ? (clientUser.name ?? null) : (initialUserData?.name ?? null)
  const email =
    isSessionLoaded && clientUser ? (clientUser.email ?? null) : (initialUserData?.email ?? null)

  // For avatar: use session image URL once loaded, fall back to SSR data
  // During hydration, MUST use SSR data to prevent hydration mismatch
  // After hydration, use session image (which may be /api/user/avatar/... URL)
  // Important: if session is loaded but image is empty/null, show no avatar (not SSR fallback)
  const avatarUrl = isSessionLoaded
    ? clientUser?.image || null // Use session image or null (for initials fallback)
    : (initialUserData?.avatarUrl ?? null) // During hydration, use SSR data

  // Team members (owner, admin, member) can access admin dashboard
  // Use client role if fetched, otherwise fall back to server prop
  const effectiveRole = isRoleFetched ? clientRole : userRole
  const canAccessAdmin = isLoggedIn && ['owner', 'admin', 'member'].includes(effectiveRole || '')

  const handleSignOut = () => {
    signOut({
      fetchOptions: {
        onSuccess: () => {
          setClientRole(null)
          setIsRoleFetched(true)
          router.push('/')
          refetchSession()
        },
      },
    })
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 flex h-14 items-center">
        {/* Logo / Org Name */}
        <Link href="/" className="flex items-center gap-2 mr-6">
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
          <span className="font-semibold hidden sm:inline-block">{orgName}</span>
        </Link>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/' || /^\/[^/]+\/posts\//.test(pathname)
                : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-3 py-2 text-sm font-medium transition-colors [border-radius:calc(var(--radius)*0.8)]',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Admin Button (visible for team members) */}
        {canAccessAdmin && (
          <Button variant="outline" size="sm" asChild className="mr-2">
            <Link href="/admin">
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
                <Link href="/settings">
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
        ) : (
          // Anonymous user - show login/signup buttons
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => openAuthPopover({ mode: 'login' })}>
              Log in
            </Button>
            <Button size="sm" onClick={() => openAuthPopover({ mode: 'signup' })}>
              Sign up
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
