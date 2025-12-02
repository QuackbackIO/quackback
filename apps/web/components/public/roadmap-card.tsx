import Link from 'next/link'
import { ChevronUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface RoadmapCardProps {
  id: string
  title: string
  voteCount: number
  board: {
    slug: string
    name: string
  }
}

export function RoadmapCard({ id, title, voteCount, board }: RoadmapCardProps) {
  return (
    <Link href={`/boards/${board.slug}/posts/${id}`}>
      <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto flex flex-col items-center px-2 py-1 text-muted-foreground hover:text-foreground"
              asChild
            >
              <div>
                <ChevronUp className="h-4 w-4" />
                <span className="text-xs font-medium">{voteCount}</span>
              </div>
            </Button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium line-clamp-2">{title}</p>
              <Badge variant="outline" className="mt-2 text-xs">
                {board.name}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
