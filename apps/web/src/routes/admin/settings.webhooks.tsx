import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { BoltIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { adminQueries } from '@/lib/client/queries/admin'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WebhooksSettings } from '@/components/admin/settings/webhooks/webhooks-settings'

export const Route = createFileRoute('/admin/settings/webhooks')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.webhooks())

    return {}
  },
  component: WebhooksPage,
})

function WebhooksPage() {
  const webhooksQuery = useSuspenseQuery(adminQueries.webhooks())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={BoltIcon}
        title="Webhooks"
        description="Send real-time notifications to external services when events occur"
      />

      <SettingsCard
        title="Configured Webhooks"
        description="Webhooks receive HTTP POST requests when events happen in your workspace"
      >
        <WebhooksSettings webhooks={webhooksQuery.data} />
      </SettingsCard>

      <SettingsCard
        title="Webhook Documentation"
        description="Learn how to receive and verify webhooks"
      >
        <div className="text-sm text-muted-foreground">
          <p className="mb-3">
            Webhooks allow you to receive real-time notifications when posts are created, statuses
            change, vote milestones are reached, or comments are added.
          </p>
          <a
            href="/api/v1/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            View API Documentation
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
                clipRule="evenodd"
              />
              <path
                fillRule="evenodd"
                d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
                clipRule="evenodd"
              />
            </svg>
          </a>
        </div>
      </SettingsCard>
    </div>
  )
}
