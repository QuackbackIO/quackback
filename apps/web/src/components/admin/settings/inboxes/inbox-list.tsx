/**
 * `<InboxList />` — table of all inboxes with name (color dot), slug, primary
 * team, defaults summary, and active/archived chip. Row click navigates to
 * the detail page. The "Show archived" toggle reveals soft-deleted rows.
 */
import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { InboxId } from '@quackback/ids'
import { inboxQueries } from '@/lib/client/queries/inboxes'
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

export function InboxList() {
  const [showArchived, setShowArchived] = useState(false)
  const { data: inboxes } = useSuspenseQuery(inboxQueries.list({ includeArchived: true }))

  const rows = useMemo(
    () => (showArchived ? inboxes : inboxes.filter((i) => i.archivedAt == null)),
    [inboxes, showArchived]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
        <Label htmlFor="show-archived" className="text-xs font-normal">
          Show archived
        </Label>
      </div>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Defaults</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                  No inboxes yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((inbox) => (
                <TableRow key={inbox.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link
                      to="/admin/settings/inboxes/$inboxId"
                      params={{ inboxId: inbox.id as InboxId }}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full border border-border/50"
                        style={{ backgroundColor: inbox.color ?? 'transparent' }}
                      />
                      <span className="truncate">{inbox.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {inbox.slug}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {inbox.defaultPriority} · {inbox.defaultVisibilityScope}
                  </TableCell>
                  <TableCell>
                    {inbox.archivedAt ? (
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
