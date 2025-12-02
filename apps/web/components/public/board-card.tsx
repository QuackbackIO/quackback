import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

interface BoardCardProps {
  slug: string
  name: string
  description?: string | null
  postCount: number
}

export function BoardCard({ slug, name, description, postCount }: BoardCardProps) {
  return (
    <Link href={`/boards/${slug}`}>
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle className="text-lg">{name}</CardTitle>
          {description && (
            <CardDescription className="line-clamp-2">{description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            <span>
              {postCount} {postCount === 1 ? 'post' : 'posts'}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
