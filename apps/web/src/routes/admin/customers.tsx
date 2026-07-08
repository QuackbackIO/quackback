import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/admin/customers')({
  component: CustomersLayout,
})

function CustomersLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const tabs: { label: string; to: string }[] = [
    { label: 'People', to: '/admin/customers/people' },
    { label: 'Organizations', to: '/admin/customers/organizations' },
    { label: 'Segments', to: '/admin/customers/segments' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Customers</h1>
        <p className="text-sm text-muted-foreground">People, organizations, and segments.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border/60">
        {tabs.map((tab) => {
          const active = pathname === tab.to || pathname.startsWith(tab.to + '/')
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                'px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <Outlet />
    </div>
  )
}
