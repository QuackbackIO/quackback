import { createFileRoute } from '@tanstack/react-router'
import { TagIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { TagList } from '@/components/admin/settings/tags/tag-list'

export const Route = createFileRoute('/admin/settings/tags')({
  component: TagsPage,
})

function TagsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={TagIcon}
        title="Tags"
        description="Organize and categorize feedback with tags"
      />

      <TagList />
    </div>
  )
}
