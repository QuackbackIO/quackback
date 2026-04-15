import { createFileRoute } from '@tanstack/react-router'
import { HelpCenterList } from '@/components/admin/help-center/help-center-list'

export const Route = createFileRoute('/admin/help-center/')({
  component: HelpCenterIndexPage,
})

function HelpCenterIndexPage() {
  return (
    <main className="h-full">
      <HelpCenterList />
    </main>
  )
}
