import { UserGroupIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  SegmentMultiSelect,
  type SegmentItem,
} from '@/components/admin/segments/segment-multi-select'

interface ArticleAudienceControlProps {
  segments: SegmentItem[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

/**
 * Audience picker for the article editor top bar. An empty selection means
 * the article is visible to everyone; any selection restricts it to visitors
 * in those segments.
 */
export function ArticleAudienceControl({
  segments,
  value,
  onChange,
  disabled,
}: ArticleAudienceControlProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 rounded-full text-xs px-3"
          aria-label="Audience"
        >
          <UserGroupIcon className="h-3.5 w-3.5" />
          Audience
          {value.length === 0 ? (
            <span className="text-muted-foreground">Everyone</span>
          ) : (
            <Badge size="sm" shape="pill" variant="secondary">
              {value.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-xs font-medium text-foreground">Audience</p>
        <p className="mt-0.5 mb-2.5 text-xs text-muted-foreground">
          With segments selected, the article is only visible to the selected segments.
        </p>
        {segments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No segments defined yet.</p>
        ) : (
          <SegmentMultiSelect
            segments={segments}
            value={value}
            onChange={onChange}
            disabled={disabled}
            ariaLabel="Article audience segments"
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
