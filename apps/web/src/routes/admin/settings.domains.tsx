import { createFileRoute } from '@tanstack/react-router'
import { GlobeAltIcon } from '@heroicons/react/24/outline'

export const Route = createFileRoute('/admin/settings/domains')({
  component: DomainsPage,
})

function DomainsPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Custom Domains</h1>
        <p className="text-sm text-muted-foreground">
          Connect your own domain to your feedback portal
        </p>
      </div>

      {/* Placeholder Card */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <GlobeAltIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium text-foreground mb-1">Coming soon</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            We're working on custom domains so you can use something like feedback.yourcompany.com.
            SSL certificates will be handled for you.
          </p>
        </div>
      </div>
    </div>
  )
}
