'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, Map, Users, LogOut, Settings, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toExternalPath } from '@/lib/tenant-paths'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signOut, useSession } from '@/lib/auth/client'

interface AdminNavProps {
  /** Initial user data for SSR (store values override these after hydration) */
  initialUserData?: {
    name: string | null
    email: string | null
    avatarUrl: string | null
  }
}

const navItems = [
  {
    label: 'Feedback',
    href: '/admin/feedback',
    icon: MessageSquare,
  },
  {
    label: 'Roadmap',
    href: '/admin/roadmap',
    icon: Map,
  },
  {
    label: 'Users',
    href: '/admin/users',
    icon: Users,
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    icon: Settings,
  },
]

export function AdminNav({ initialUserData }: AdminNavProps) {
  const rawPathname = usePathname()
  const pathname = toExternalPath(rawPathname)

  // Track if we've completed initial hydration to prevent SSR/client mismatch
  const [isHydrated, setIsHydrated] = useState(false)
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Client-side session state - updates without page reload
  const { data: sessionData, isPending, refetch: refetchSession } = useSession()

  // Derive user data from client session when available
  // During initial hydration (!isHydrated), ALWAYS use server props to match SSR output
  const clientUser = sessionData?.user
  const isSessionLoaded = isHydrated && !isPending

  // Use client session once loaded, otherwise fall back to server-provided data
  const name =
    isSessionLoaded && clientUser ? (clientUser.name ?? null) : (initialUserData?.name ?? null)
  const email =
    isSessionLoaded && clientUser ? (clientUser.email ?? null) : (initialUserData?.email ?? null)
  // For avatar: use session image URL once loaded, fall back to SSR data
  // During hydration, MUST use SSR data (base64 blob) to prevent hydration mismatch
  // After hydration, use session image which includes the /api/user/avatar/... URL
  const avatarUrl = isSessionLoaded
    ? (clientUser?.image ?? null)
    : (initialUserData?.avatarUrl ?? null)

  return (
    <header className="border-b border-border bg-card">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/admin">
            <img src="/logo.png" alt="Quackback" width={32} height={32} />
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              const Icon = item.icon

              return (
                <Button
                  key={item.href}
                  variant={isActive ? 'secondary' : 'ghost'}
                  size="sm"
                  asChild
                >
                  <Link href={item.href}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {/* Portal Button */}
          <Button variant="outline" size="sm" asChild>
            <Link href="/">
              <Globe className="mr-2 h-4 w-4" />
              Portal
            </Link>
          </Button>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        // Refetch to clear session, then redirect
                        refetchSession()
                        window.location.href = '/'
                      },
                    },
                  })
                }
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
