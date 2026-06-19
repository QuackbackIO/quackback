import { SidebarContainer, SidebarSkeleton } from '@/components/shared/sidebar-primitives'
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'
import type { PostId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'
import type { ChangelogAccess } from '@/lib/shared/db-types'

export { SidebarSkeleton as ChangelogMetadataSidebarSkeleton }

interface ChangelogMetadataSidebarProps {
  publishState: PublishState
  onPublishStateChange: (state: PublishState) => void
  access: ChangelogAccess
  onAccessChange: (access: ChangelogAccess) => void
  linkedPostIds: PostId[]
  onLinkedPostsChange: (postIds: PostId[]) => void
  authorName?: string | null
}

export function ChangelogMetadataSidebar({
  publishState,
  onPublishStateChange,
  access,
  onAccessChange,
  linkedPostIds,
  onLinkedPostsChange,
  authorName,
}: ChangelogMetadataSidebarProps) {
  return (
    <SidebarContainer className="overflow-y-auto">
      <ChangelogMetadataSidebarContent
        publishState={publishState}
        onPublishStateChange={onPublishStateChange}
        access={access}
        onAccessChange={onAccessChange}
        linkedPostIds={linkedPostIds}
        onLinkedPostsChange={onLinkedPostsChange}
        authorName={authorName}
      />
    </SidebarContainer>
  )
}
