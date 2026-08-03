import { SidebarContainer, SidebarSkeleton } from '@/components/shared/sidebar-primitives'
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'
import type { PostId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'

export { SidebarSkeleton as ChangelogMetadataSidebarSkeleton }

interface ChangelogMetadataSidebarProps {
  publishState: PublishState
  onPublishStateChange: (state: PublishState) => void
  linkedPostIds: PostId[]
  onLinkedPostsChange: (postIds: PostId[]) => void
  categoryName: string
  onCategoryNameChange: (name: string) => void
  productName: string
  onProductNameChange: (name: string) => void
  authorName?: string | null
  publishedAt?: string | null
  displayDateValue?: Date
  onDisplayDateChange?: (value: Date | undefined) => void
  onDisplayDateClear?: () => void
}

export function ChangelogMetadataSidebar({
  publishState,
  onPublishStateChange,
  linkedPostIds,
  onLinkedPostsChange,
  categoryName,
  onCategoryNameChange,
  productName,
  onProductNameChange,
  authorName,
  publishedAt,
  displayDateValue,
  onDisplayDateChange,
  onDisplayDateClear,
}: ChangelogMetadataSidebarProps) {
  return (
    <SidebarContainer className="overflow-y-auto">
      <ChangelogMetadataSidebarContent
        publishState={publishState}
        onPublishStateChange={onPublishStateChange}
        linkedPostIds={linkedPostIds}
        onLinkedPostsChange={onLinkedPostsChange}
        categoryName={categoryName}
        onCategoryNameChange={onCategoryNameChange}
        productName={productName}
        onProductNameChange={onProductNameChange}
        authorName={authorName}
        publishedAt={publishedAt}
        displayDateValue={displayDateValue}
        onDisplayDateChange={onDisplayDateChange}
        onDisplayDateClear={onDisplayDateClear}
      />
    </SidebarContainer>
  )
}
