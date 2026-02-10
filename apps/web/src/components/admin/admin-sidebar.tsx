import { useState } from 'react'
import { Link, useRouter, useRouterState, useRouteContext } from '@tanstack/react-router'
import {
  ChatBubbleLeftIcon,
  HomeIcon,
  MapIcon,
  UsersIcon,
  ArrowRightOnRectangleIcon,
  Cog6ToothIcon,
  Bars3Icon,
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
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
import { signOut } from '@/lib/server/auth/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { NotificationBell } from '@/components/notifications'
import { cn } from '@/lib/shared/utils'

interface AdminSidebarProps {
  initialUserData?: {
    name: string | null
    email: string | null
    avatarUrl: string | null
  }
}

const navItems = [
  { label: 'Home', href: '/admin', icon: HomeIcon, exact: true },
  { label: 'Feedback', href: '/admin/feedback', icon: ChatBubbleLeftIcon },
  { label: 'Roadmap', href: '/admin/roadmap', icon: MapIcon },
  { label: 'Changelog', href: '/admin/changelog', icon: DocumentTextIcon },
  { label: 'Users', href: '/admin/users', icon: UsersIcon },
  { label: 'Settings', href: '/admin/settings', icon: Cog6ToothIcon },
]

function isNavActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href || pathname === href + '/'
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
            'flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200',
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

export function AdminSidebar({ initialUserData }: AdminSidebarProps) {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const user = session?.user
  const name = user?.name ?? initialUserData?.name ?? null
  const email = user?.email ?? initialUserData?.email ?? null
  const avatarUrl = user?.image ?? initialUserData?.avatarUrl ?? null

  const handleSignOut = async () => {
    await signOut()
    router.invalidate()
    window.location.href = '/'
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden sm:flex w-16 shrink-0 flex-col">
        <div className="flex flex-col h-full py-6">
          {/* Logo */}
          <Link
            to="/admin"
            className="flex items-center justify-center mb-8 opacity-90 hover:opacity-100 transition-opacity"
          >
            <img src="/logo.png" alt="Quackback" width={28} height={28} className="rounded" />
          </Link>

          {/* Main Navigation */}
          <nav className="flex flex-col items-center gap-3">
            {navItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                isActive={isNavActive(pathname, item.href, item.exact)}
              />
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1 min-h-12" />

          {/* Bottom Section */}
          <div className="flex flex-col items-center gap-3">
            {/* Notifications */}
            <NotificationBell />

            {/* Portal Link */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/"
                  className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
                >
                  <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                  <span className="sr-only">View Portal</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                View Portal
              </TooltipContent>
            </Tooltip>

            {/* User Menu */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-muted/50 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Avatar className="h-7 w-7" src={avatarUrl} name={name} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Account
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">{email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Cog6ToothIcon className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <ArrowRightOnRectangleIcon className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
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
                  <img src="/logo.png" alt="Quackback" width={28} height={28} className="rounded" />
                </Link>
                <span className="text-base font-semibold">Quackback</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1.5 px-4 py-3">
              {navItems.map((item) => {
                const isActive = isNavActive(pathname, item.href, item.exact)
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
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                View Portal
              </Link>
            </nav>
          </SheetContent>
        </Sheet>

        <Link to="/admin" className="absolute left-1/2 -translate-x-1/2">
          <img src="/logo.png" alt="Quackback" width={28} height={28} className="rounded" />
        </Link>

        <div className="flex items-center gap-1">
          <NotificationBell className="h-9 w-9" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-9 w-9 rounded-full flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-8 w-8" src={avatarUrl} name={name} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium truncate">{name}</p>
                  <p className="text-xs text-muted-foreground truncate">{email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Cog6ToothIcon className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <ArrowRightOnRectangleIcon className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  )
}
