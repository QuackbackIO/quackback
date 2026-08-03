/**
 * `<TeamList />` — table of workspace teams with name, slug, short label chip,
 * and active/archived status. Show-archived toggle.
 */
import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { TeamId } from '@quackback/ids'
import { teamQueries } from '@/lib/client/queries/teams'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

export function TeamList() {
  const [showArchived, setShowArchived] = useState(false)
  const { data: teams } = useSuspenseQuery(teamQueries.list({ includeArchived: true }))

  const rows = useMemo(
    () => (showArchived ? teams : teams.filter((t) => t.archivedAt == null)),
    [teams, showArchived]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Switch id="show-archived-teams" checked={showArchived} onCheckedChange={setShowArchived} />
        <Label htmlFor="show-archived-teams" className="text-xs font-normal">
          Show archived
        </Label>
      </div>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="w-32">Short label</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                  No teams yet. Create your first team.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((team) => (
                <TableRow key={team.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link
                      to="/admin/settings/teams/$teamId"
                      params={{ teamId: team.id as TeamId }}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm border border-border/50"
                        style={{ backgroundColor: team.color ?? 'transparent' }}
                        aria-hidden
                      />
                      <span className="truncate">{team.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {team.slug}
                  </TableCell>
                  <TableCell>
                    {team.shortLabel ? (
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: team.color ?? 'var(--muted)',
                          color: team.color ? '#fff' : undefined,
                        }}
                      >
                        {team.shortLabel}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {team.archivedAt ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Archived
                      </Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
