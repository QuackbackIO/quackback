/**
 * Legacy contacts detail shell. List routes redirect to Customers; detail
 * routes still render here until they move to canonical Customers paths.
 */
import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/admin/contacts')({
  component: ContactsLayout,
})

function ContactsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const tabs: { label: string; to: string }[] = [
    { label: 'People', to: '/admin/customers/people' },
    { label: 'Organizations', to: '/admin/customers/organizations' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Customers</h1>
        <p className="text-sm text-muted-foreground">People, organizations, and segments.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border/60">
        {tabs.map((t) => {
          const active =
            pathname === t.to ||
            pathname.startsWith(t.to + '/') ||
            (t.to === '/admin/customers/people' && pathname.startsWith('/admin/contacts/people')) ||
            (t.to === '/admin/customers/organizations' &&
              pathname.startsWith('/admin/contacts/organizations'))
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                'px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      <Outlet />
    </div>
  )
}
