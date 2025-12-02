'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface PortalHeaderProps {
  orgName: string
  orgLogo?: string | null
}

const navItems = [
  { href: '/', label: 'Boards' },
  { href: '/roadmap', label: 'Roadmap' },
]

export function PortalHeader({ orgName, orgLogo }: PortalHeaderProps) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 flex h-14 items-center">
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
                ? pathname === '/' || pathname.startsWith('/boards')
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

        {/* Login / Admin Link */}
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">Admin</Link>
        </Button>
      </div>
    </header>
  )
}
