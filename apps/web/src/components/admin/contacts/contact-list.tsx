/**
 * Cross-org contact table. Resolves organization names via list-cache lookup.
 */
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery } from '@tanstack/react-query'
import type { ContactId } from '@quackback/ids'
import { contactQueries } from '@/lib/client/queries/contacts'
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

export function ContactList({ search, showArchived }: Props) {
  const { data: contacts } = useSuspenseQuery(
    contactQueries.search({ query: search, includeArchived: showArchived })
  )

  // Best-effort org name lookup. Stays optional so we don't block the list.
  const orgsQuery = useQuery(organizationQueries.list({ includeArchived: true }))
  const orgMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orgsQuery.data ?? []) m.set(o.id, o.name)
    return m
  }, [orgsQuery.data])

  return (
    <div className="rounded-md border border-border/50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="w-24">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                No contacts.
              </TableCell>
            </TableRow>
          ) : (
            contacts.map((c) => (
              <TableRow key={c.id} className="hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link
                    to="/admin/contacts/people/$contactId"
                    params={{ contactId: c.id as ContactId }}
                  >
                    {c.name ?? c.email ?? c.id}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.email ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.organizationId ? (orgMap.get(c.organizationId) ?? c.organizationId) : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.title ?? '—'}</TableCell>
                <TableCell>
                  {c.archivedAt ? (
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
