import Link from 'next/link'
import { requireTenantRole } from '@/lib/tenant'
import { ArrowLeft, GitBranch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export default async function LinearIntegrationPage({
  params,
}: {
  params?: Promise<{}>
}) {
  // Settings is validated in root layout
  await requireTenantRole( ['owner', 'admin'])

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link
        href="/admin/settings/integrations"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Integrations
      </Link>

      {/* Page Header */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#5E6AD2]">
          <span className="text-white font-bold text-xl">L</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">Linear</h1>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Sync feedback with Linear issues for seamless project management.
          </p>
        </div>
      </div>

      {/* Coming Soon Content */}
      <div className="rounded-xl border border-border/50 bg-card p-8 shadow-sm">
        <div className="text-center py-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#5E6AD2]/10 mx-auto mb-4">
            <GitBranch className="h-8 w-8 text-[#5E6AD2]" />
          </div>
          <h2 className="text-lg font-medium mb-2">Linear integration coming soon</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            We're working on Linear integration to let you create and sync issues directly from
            feedback posts. Stay tuned for updates!
          </p>
        </div>
      </div>
    </div>
  )
}
