import { useQuery } from '@tanstack/react-query'
import {
  SidebarContainer,
  SidebarRow,
  SidebarDivider,
} from '@/components/shared/sidebar-primitives'
import { helpCenterQueries } from '@/lib/client/queries/help-center'

interface HelpCenterMetadataSidebarProps {
  categoryId?: string
  onCategoryChange: (categoryId: string) => void
  isPublished: boolean
  onPublishToggle: () => void
  authorName?: string | null
}

function SidebarContent({
  categoryId,
  onCategoryChange,
  isPublished,
  onPublishToggle,
  authorName,
}: HelpCenterMetadataSidebarProps) {
  const { data: categories } = useQuery(helpCenterQueries.categories())

  return (
    <>
      <SidebarRow label="Status">
        <button type="button" onClick={onPublishToggle} className="flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: isPublished ? '#22c55e' : '#a1a1aa' }}
          />
          {isPublished ? 'Published' : 'Draft'}
        </button>
      </SidebarRow>

      <SidebarDivider />

      <SidebarRow label="Category">
        <select
          value={categoryId || ''}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="w-full text-sm bg-transparent border border-border/50 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select category...</option>
          {categories?.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </SidebarRow>

      {authorName && (
        <>
          <SidebarDivider />
          <SidebarRow label="Author">
            <span className="text-sm text-foreground">{authorName}</span>
          </SidebarRow>
        </>
      )}
    </>
  )
}

export function HelpCenterMetadataSidebar(props: HelpCenterMetadataSidebarProps) {
  return (
    <SidebarContainer className="overflow-y-auto">
      <SidebarContent {...props} />
    </SidebarContainer>
  )
}

export { SidebarContent as HelpCenterMetadataSidebarContent }
