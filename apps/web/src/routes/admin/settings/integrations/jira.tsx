import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonIntegration } from '@/components/admin/settings/integrations/coming-soon-integration'
import { jiraIntegration } from '@/lib/server/integrations/jira'

export const Route = createFileRoute('/admin/settings/integrations/jira')({
  component: JiraIntegrationPage,
})

function JiraIntegrationPage() {
  return <ComingSoonIntegration catalog={jiraIntegration.catalog} />
}
