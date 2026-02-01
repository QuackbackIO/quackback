import { createFileRoute } from '@tanstack/react-router'
import { ChangelogList } from '@/components/admin/changelog'

export const Route = createFileRoute('/admin/changelog')({
  component: ChangelogPage,
})

function ChangelogPage() {
  return (
    <main className="h-full bg-card">
      <ChangelogList />
    </main>
  )
}
