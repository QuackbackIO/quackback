import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonIntegration } from '@/components/admin/settings/integrations/coming-soon-integration'
import { discordIntegration } from '@/lib/server/integrations/discord'

export const Route = createFileRoute('/admin/settings/integrations/discord')({
  component: DiscordIntegrationPage,
})

function DiscordIntegrationPage() {
  return <ComingSoonIntegration catalog={discordIntegration.catalog} />
}
