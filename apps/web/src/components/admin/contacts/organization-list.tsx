/**
 * Table of organizations with name (Link), domain, website, externalId, status.
 */
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { OrganizationId } from '@quackback/ids'
import { organizationQueries } from '@/lib/client/queries/organizations'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface Props {
  search: string
  showArchived: boolean
}

export function OrganizationList({ search, showArchived }: Props) {
  const trimmedSearch = search.trim()
  const { data: orgs } = useSuspenseQuery(
    organizationQueries.list({
      includeArchived: true,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    })
  )

  const rows = useMemo(
    () => (showArchived ? orgs : orgs.filter((o) => o.archivedAt == null)),
    [orgs, showArchived]
  )

  return (
    <div className="rounded-md border border-border/50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Domain</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>External ID</TableHead>
            <TableHead className="w-24">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                No organizations.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((org) => (
              <TableRow key={org.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link
                    to="/admin/contacts/organizations/$organizationId"
                    params={{ organizationId: org.id as OrganizationId }}
                  >
                    {org.name}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{org.domain ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {org.website ?? '—'}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {org.externalId ?? '—'}
                </TableCell>
                <TableCell>
                  {org.archivedAt ? (
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
  )
}
