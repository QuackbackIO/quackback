import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonIntegration } from '@/components/admin/settings/integrations/coming-soon-integration'

export const Route = createFileRoute('/admin/settings/integrations/jira')({
  component: JiraIntegrationPage,
})

function JiraIntegrationPage() {
  return (
    <ComingSoonIntegration
      name="Jira"
      description="Create and sync Jira issues from feedback posts."
      iconBg="bg-[#0052CC]"
    />
  )
}
