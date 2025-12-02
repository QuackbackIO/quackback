import { CircleCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
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
    <Card className="border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-full bg-primary/10 p-2">
          <CircleCheck className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold">{organizationName}</span>
            <Badge variant="default" className="bg-primary text-primary-foreground">
              Official Response
            </Badge>
            <span className="text-muted-foreground">·</span>
            <TimeAgo date={respondedAt} className="text-xs text-muted-foreground" />
          </div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
          {authorName && <p className="text-xs text-muted-foreground mt-2">— {authorName}</p>}
        </div>
      </div>
    </Card>
  )
}
