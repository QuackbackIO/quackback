import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Avatar } from '@/components/ui/avatar'

interface TopContributorsProps {
  contributors: Array<{
    principalId: string
    displayName: string | null
    avatarUrl: string | null
    posts: number
    votes: number
    comments: number
    total: number
  }>
}

export function AnalyticsTopContributors({ contributors }: TopContributorsProps) {
  if (contributors.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No contributor activity in this period
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Contributor</TableHead>
          <TableHead className="w-20 text-right">Posts</TableHead>
          <TableHead className="w-20 text-right">Votes</TableHead>
          <TableHead className="w-24 text-right">Comments</TableHead>
          <TableHead className="w-20 text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contributors.map((c) => (
          <TableRow key={c.principalId}>
            <TableCell>
              <div className="flex items-center gap-2">
                <Avatar src={c.avatarUrl} name={c.displayName} className="size-7 text-xs" />
                <span className="font-medium">{c.displayName ?? 'Anonymous'}</span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{c.posts}</TableCell>
            <TableCell className="text-right tabular-nums">{c.votes}</TableCell>
            <TableCell className="text-right tabular-nums">{c.comments}</TableCell>
            <TableCell className="text-right tabular-nums font-medium">{c.total}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
