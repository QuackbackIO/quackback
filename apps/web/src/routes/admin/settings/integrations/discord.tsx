import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/settings/integrations/discord')({
  component: DiscordIntegrationPage,
})

function DiscordIntegrationPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Discord Integration</h1>
      <p className="text-muted-foreground mt-2">Coming soon...</p>
    </div>
  )
}
