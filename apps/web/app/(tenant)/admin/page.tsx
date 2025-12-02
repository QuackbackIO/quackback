import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/tenant'
import { db, boards, eq } from '@quackback/db'
import { MessageSquare, Plus, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default async function AdminPage() {
  const { organization } = await requireTenant()

  // Check if org has boards - if not, redirect to onboarding
  const orgBoards = await db.query.boards.findMany({
    where: eq(boards.organizationId, organization.id),
    orderBy: (boards, { desc }) => [desc(boards.createdAt)],
  })

  if (orgBoards.length === 0) {
    redirect('/onboarding')
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Feedback Boards</h2>
        <Button asChild>
          <Link href="/boards/new">
            <Plus className="h-4 w-4" />
            New Board
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {orgBoards.map((board) => (
          <Link key={board.id} href={`/boards/${board.slug}`} className="group">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardContent>
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <MessageSquare className="h-5 w-5 text-primary" />
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <h3 className="mt-4 font-medium text-foreground">{board.name}</h3>
                {board.description && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {board.description}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <Badge variant={board.isPublic ? 'default' : 'secondary'}>
                    {board.isPublic ? 'Public' : 'Private'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  )
}
