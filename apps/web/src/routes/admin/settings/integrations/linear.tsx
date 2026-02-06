import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonIntegration } from '@/components/admin/settings/integrations/coming-soon-integration'

export const Route = createFileRoute('/admin/settings/integrations/linear')({
  component: LinearIntegrationPage,
})

function LinearIntegrationPage() {
  return (
    <ComingSoonIntegration
      name="Linear"
      description="Sync feedback with Linear issues for seamless project management."
      iconBg="bg-[#5E6AD2]"
    />
  )
}
