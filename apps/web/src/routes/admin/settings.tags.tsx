import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { TagIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { TagList } from '@/components/admin/settings/tags/tag-list'

export const Route = createFileRoute('/admin/settings/tags')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.tags())
    return {}
  },
  component: TagsPage,
})

function TagsPage() {
  const tagsQuery = useSuspenseQuery(adminQueries.tags())

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

      <TagList initialTags={tagsQuery.data} />
    </div>
  )
}
