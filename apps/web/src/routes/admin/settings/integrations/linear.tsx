import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonIntegration } from '@/components/admin/settings/integrations/coming-soon-integration'
import { linearIntegration } from '@/lib/server/integrations/linear'

export const Route = createFileRoute('/admin/settings/integrations/linear')({
  component: LinearIntegrationPage,
})

function LinearIntegrationPage() {
  return <ComingSoonIntegration catalog={linearIntegration.catalog} />
}
