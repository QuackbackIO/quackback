import { CircleCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/ui/time-ago'

interface OfficialResponseProps {
  content: string
  authorName: string | null
  respondedAt: Date
  organizationName: string
}

export function OfficialResponse({
  content,
  authorName,
  respondedAt,
  organizationName,
}: OfficialResponseProps) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-full bg-primary/15 p-1.5">
          <CircleCheck className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{organizationName}</span>
            <Badge className="text-[10px] px-1.5 py-0">Official</Badge>
            <span className="text-muted-foreground/60">·</span>
            <TimeAgo date={respondedAt} className="text-xs text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {content}
          </p>
          {authorName && <p className="text-xs text-muted-foreground mt-3">— {authorName}</p>}
        </div>
      </div>
    </div>
  )
}
