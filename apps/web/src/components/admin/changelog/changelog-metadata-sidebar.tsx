import { SidebarContainer, SidebarSkeleton } from '@/components/shared/sidebar-primitives'
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'
import type { PostId, ChangelogCategoryId, SegmentId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'

export { SidebarSkeleton as ChangelogMetadataSidebarSkeleton }

interface ChangelogMetadataSidebarProps {
  publishState: PublishState
  onPublishStateChange: (state: PublishState) => void
  linkedPostIds: PostId[]
  onLinkedPostsChange: (postIds: PostId[]) => void
  categoryIds: ChangelogCategoryId[]
  onCategoriesChange: (categoryIds: ChangelogCategoryId[]) => void
  notify: boolean
  onNotifyChange: (notify: boolean) => void
  /** Publish-notification targeting; empty = notify every subscriber. */
  segmentIds?: SegmentId[]
  onSegmentIdsChange?: (segmentIds: SegmentId[]) => void
  authorName?: string | null
  publishedAt?: string | null
  displayDateValue?: Date
  onDisplayDateChange?: (value: Date | undefined) => void
  onDisplayDateClear?: () => void
  featuredImageUrl?: string | null
  onFeaturedImageChange?: (url: string | null) => void
}

export function ChangelogMetadataSidebar({
  publishState,
  onPublishStateChange,
  linkedPostIds,
  onLinkedPostsChange,
  categoryIds,
  onCategoriesChange,
  notify,
  onNotifyChange,
  segmentIds,
  onSegmentIdsChange,
  authorName,
  publishedAt,
  displayDateValue,
  onDisplayDateChange,
  onDisplayDateClear,
  featuredImageUrl,
  onFeaturedImageChange,
}: ChangelogMetadataSidebarProps) {
  return (
    <SidebarContainer className="overflow-y-auto">
      <ChangelogMetadataSidebarContent
        publishState={publishState}
        onPublishStateChange={onPublishStateChange}
        linkedPostIds={linkedPostIds}
        onLinkedPostsChange={onLinkedPostsChange}
        categoryIds={categoryIds}
        onCategoriesChange={onCategoriesChange}
        notify={notify}
        onNotifyChange={onNotifyChange}
        segmentIds={segmentIds}
        onSegmentIdsChange={onSegmentIdsChange}
        authorName={authorName}
        publishedAt={publishedAt}
        displayDateValue={displayDateValue}
        onDisplayDateChange={onDisplayDateChange}
        onDisplayDateClear={onDisplayDateClear}
        featuredImageUrl={featuredImageUrl}
        onFeaturedImageChange={onFeaturedImageChange}
      />
    </SidebarContainer>
  )
}
