import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@heroicons/react/24/solid'
import {
  SidebarContainer,
  SidebarRow,
  SidebarDivider,
} from '@/components/shared/sidebar-primitives'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { CategoryFormDialog } from './category-form-dialog'

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
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
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
        <div className="flex items-center gap-1.5">
          <select
            value={categoryId || ''}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="flex-1 text-sm bg-transparent border border-border/50 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select category...</option>
            {categories?.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.icon ? `${cat.icon} ` : ''}
                {cat.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreateCategoryOpen(true)}
            className="h-7 w-7 flex items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            title="Create new category"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </SidebarRow>

      <CategoryFormDialog
        open={createCategoryOpen}
        onOpenChange={setCreateCategoryOpen}
        onCreated={(id) => onCategoryChange(id)}
      />

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
