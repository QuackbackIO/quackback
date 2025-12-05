'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
import { useUserProfileStore } from '@/lib/stores/user-profile'

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
  const storeData = useUserProfileStore()

  // Use store values if hydrated, fall back to initial props for SSR
  const name = storeData.name ?? initialUserData?.name ?? null
  const email = storeData.email ?? initialUserData?.email ?? null
  const avatarUrl = storeData.avatarUrl ?? initialUserData?.avatarUrl ?? null

  // Use userRole from server as source of truth for auth state (prevents flicker)
  // userRole is null for anonymous users, set for logged-in users
  const isLoggedIn = userRole !== null && userRole !== undefined
  // Team members (owner, admin, member) can access admin dashboard
  const canAccessAdmin = isLoggedIn && ['owner', 'admin', 'member'].includes(userRole || '')

  const handleSignOut = () => {
    signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = '/'
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
            <img src={orgLogo} alt={orgName} className="h-8 w-8 rounded" />
          ) : (
            <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-semibold">
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
                  'px-3 py-2 text-sm font-medium rounded-md transition-colors',
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
              {canAccessAdmin && (
                <DropdownMenuItem asChild>
                  <Link href="/admin">
                    <Shield className="mr-2 h-4 w-4" />
                    Admin
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // Anonymous user - show login/signup buttons
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">Sign up</Link>
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
