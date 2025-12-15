import Link from 'next/link'
import { requireTenantRoleBySlug } from '@/lib/tenant'
import { ArrowLeft, Ticket } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export default async function JiraIntegrationPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

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
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#0052CC]">
          <span className="text-white font-bold text-xl">J</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">Jira</h1>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and sync Jira issues from feedback posts.
          </p>
        </div>
      </div>

      {/* Coming Soon Content */}
      <div className="rounded-xl border border-border/50 bg-card p-8 shadow-sm">
        <div className="text-center py-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#0052CC]/10 mx-auto mb-4">
            <Ticket className="h-8 w-8 text-[#0052CC]" />
          </div>
          <h2 className="text-lg font-medium mb-2">Jira integration coming soon</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            We're working on Jira integration to let you create and sync issues directly from
            feedback posts. Stay tuned for updates!
          </p>
        </div>
      </div>
    </div>
  )
}
