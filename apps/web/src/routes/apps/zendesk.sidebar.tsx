import { createFileRoute } from '@tanstack/react-router'
import { SidebarApp } from '@/components/integrations/zendesk/sidebar-app'

export const Route = createFileRoute('/apps/zendesk/sidebar')({
  component: ZendeskSidebar,
})

function ZendeskSidebar() {
  return <SidebarApp />
}
