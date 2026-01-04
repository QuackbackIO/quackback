import { useState } from 'react'
import { Link, useRouter, useRouterState, useRouteContext } from '@tanstack/react-router'
import { MessageSquare, Map, Users, LogOut, Settings, Globe, Menu } from 'lucide-react'
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
import { signOut } from '@/lib/auth/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

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
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Get user info from session
  const user = session?.user
  const name = user?.name ?? initialUserData?.name ?? null
  const email = user?.email ?? initialUserData?.email ?? null
  const avatarUrl = user?.image ?? initialUserData?.avatarUrl ?? null

  return (
    <header className="border-b border-border bg-card">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 sm:gap-8">
          {/* Mobile Menu */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="sm:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64">
              <SheetHeader>
                <SheetTitle>
                  <Link to="/admin" onClick={() => setMobileMenuOpen(false)}>
                    <img src="/logo.png" alt="Quackback" width={32} height={32} />
                  </Link>
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 mt-4">
                {navItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                  const Icon = item.icon

                  return (
                    <Button
                      key={item.href}
                      variant={isActive ? 'secondary' : 'ghost'}
                      className="justify-start"
                      asChild
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Link to={item.href}>
                        <Icon className="mr-2 h-4 w-4" />
                        {item.label}
                      </Link>
                    </Button>
                  )
                })}
                <div className="border-t border-border my-2" />
                <Button
                  variant="ghost"
                  className="justify-start"
                  asChild
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Link to="/">
                    <Globe className="mr-2 h-4 w-4" />
                    Portal
                  </Link>
                </Button>
              </nav>
            </SheetContent>
          </Sheet>

          <Link to="/admin" className="hidden sm:block">
            <img src="/logo.png" alt="Quackback" width={32} height={32} />
          </Link>
          {/* Mobile: Show logo in center */}
          <Link to="/admin" className="sm:hidden">
            <img src="/logo.png" alt="Quackback" width={32} height={32} />
          </Link>
          {/* Desktop Navigation */}
          <nav className="hidden sm:flex items-center gap-1">
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
                  <Link to={item.href}>
                    <Icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {/* Portal Button - Desktop only */}
          <Button variant="outline" size="sm" asChild className="hidden sm:flex">
            <Link to="/">
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
                <Link to="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await signOut()
                  router.invalidate()
                  window.location.href = '/'
                }}
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
