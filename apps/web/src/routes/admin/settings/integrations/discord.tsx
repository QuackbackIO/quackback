import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonIntegration } from '@/components/admin/settings/integrations/coming-soon-integration'

export const Route = createFileRoute('/admin/settings/integrations/discord')({
  component: DiscordIntegrationPage,
})

function DiscordIntegrationPage() {
  return (
    <ComingSoonIntegration
      name="Discord"
      description="Send notifications to your Discord server channels."
      iconBg="bg-[#5865F2]"
    />
  )
}
