import { createFileRoute } from '@tanstack/react-router'
import { BeakerIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { AssistantSandboxCard } from '@/components/admin/automation/assistant-sandbox-card'

export const Route = createFileRoute('/admin/automation/sandbox')({
  component: AutomationSandboxPage,
})

function AutomationSandboxPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">AI &amp; Automation</BackLink>
      </div>
      <PageHeader
        icon={BeakerIcon}
        title="Assistant sandbox"
        description="Chat with your assistant against live config. Nothing here is saved or added to your inbox."
      />
      <AssistantSandboxCard />
    </div>
  )
}
