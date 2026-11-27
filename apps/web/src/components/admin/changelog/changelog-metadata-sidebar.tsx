import { SidebarContainer, SidebarSkeleton } from '@/components/shared/sidebar-primitives'
import {
  ChangelogMetadataSidebarContent,
  type ChangelogMetadataSidebarContentProps,
} from './changelog-metadata-sidebar-content'

export { SidebarSkeleton as ChangelogMetadataSidebarSkeleton }

/** The entry settings in the desktop sidebar; the mobile sheet renders the
 *  same content without the container. */
export function ChangelogMetadataSidebar(props: ChangelogMetadataSidebarContentProps) {
  return (
    <SidebarContainer className="overflow-y-auto">
      <ChangelogMetadataSidebarContent {...props} />
    </SidebarContainer>
  )
}
