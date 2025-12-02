'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, Map } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface AdminNavProps {
  organizationName: string
  userEmail: string
}

const navItems = [
  {
    label: 'Feedback',
    href: '/admin',
    icon: MessageSquare,
  },
  {
    label: 'Roadmap',
    href: '/admin/roadmap',
    icon: Map,
  },
]

export function AdminNav({ organizationName, userEmail }: AdminNavProps) {
  const pathname = usePathname()

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {organizationName}
            </h1>
          </div>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/admin' && pathname.startsWith(item.href))
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
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{userEmail}</span>
        </div>
      </div>
    </header>
  )
}
