import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@heroicons/react/24/solid'
import { HandThumbDownIcon, LanguageIcon } from '@heroicons/react/24/outline'
import { CategoryIcon } from '@/components/help-center/category-icon'
import { ArticleAudienceControl } from '@/components/admin/help-center/article-audience-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SegmentItem } from '@/components/admin/segments/segment-multi-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  segments?: SegmentItem[]
  segmentIds?: string[]
  onSegmentIdsChange?: (ids: string[]) => void
  notHelpfulCount?: number
  onOpenFeedback?: () => void
  onOpenTranslations?: () => void
  publishPending?: boolean
}

function SidebarContent({
  categoryId,
  onCategoryChange,
  isPublished,
  onPublishToggle,
  authorName,
  segments,
  segmentIds,
  onSegmentIdsChange,
  notHelpfulCount,
  onOpenFeedback,
  onOpenTranslations,
  publishPending,
}: HelpCenterMetadataSidebarProps) {
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
  const { data: categories } = useQuery(helpCenterQueries.categories())

  return (
    <>
      <SidebarRow label="Status">
        <button
          type="button"
          onClick={onPublishToggle}
          disabled={publishPending}
          className="flex items-center gap-2 text-sm disabled:opacity-60"
        >
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: isPublished ? '#22c55e' : '#a1a1aa' }}
          />
          {publishPending
            ? isPublished
              ? 'Unpublishing…'
              : 'Publishing…'
            : isPublished
              ? 'Published'
              : 'Draft'}
        </button>
      </SidebarRow>

      <SidebarDivider />

      <SidebarRow label="Category">
        <div className="flex items-center gap-1.5">
          <Select value={categoryId || undefined} onValueChange={onCategoryChange}>
            <SelectTrigger size="sm" className="flex-1 min-w-0">
              <SelectValue placeholder="Select category..." />
            </SelectTrigger>
            <SelectContent align="end">
              {categories?.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  <span className="flex items-center gap-1.5">
                    {cat.icon && <CategoryIcon icon={cat.icon} className="w-4 h-4 shrink-0" />}
                    <span className="truncate">{cat.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setCreateCategoryOpen(true)}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
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

      {segments && onSegmentIdsChange ? (
        <>
          <SidebarDivider />
          <SidebarRow label="Audience">
            <ArticleAudienceControl
              segments={segments}
              value={segmentIds ?? []}
              onChange={onSegmentIdsChange}
            />
          </SidebarRow>
        </>
      ) : null}

      {onOpenTranslations ? (
        <>
          <SidebarDivider />
          <SidebarRow label="Translations">
            <Button type="button" variant="ghost" size="sm" onClick={onOpenTranslations}>
              <LanguageIcon className="h-3.5 w-3.5" />
              Manage
            </Button>
          </SidebarRow>
        </>
      ) : null}

      {onOpenFeedback && (notHelpfulCount ?? 0) > 0 ? (
        <>
          <SidebarDivider />
          <SidebarRow label="Feedback">
            <Button type="button" variant="ghost" size="sm" onClick={onOpenFeedback}>
              <HandThumbDownIcon className="h-3.5 w-3.5" />
              Unhelpful
              <Badge size="sm" shape="pill" variant="secondary">
                {notHelpfulCount}
              </Badge>
            </Button>
          </SidebarRow>
        </>
      ) : null}
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
