import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { ContactId, PrincipalId } from '@quackback/ids'
import { adminQueries } from '@/lib/client/queries/admin'
import { useMyPermissions } from '@/lib/client/hooks/use-authz-queries'
import { PERMISSIONS, type PermissionKey } from '@/lib/server/domains/authz'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'

interface Props {
  search: string
  showArchived: boolean
}

function formatCount(value: number): string {
  return value > 999 ? `${Math.round(value / 100) / 10}k` : String(value)
}

function permissionSetHas(
  permissionData: ReturnType<typeof useMyPermissions>['data'],
  permission: PermissionKey
): boolean {
  if (!permissionData) return false
  return (
    permissionData.workspacePermissions.includes(permission) ||
    permissionData.teamPermissions.some((team) => team.permissions.includes(permission))
  )
}

export function CustomerPeopleTable({ search, showArchived }: Props) {
  const trimmedSearch = search.trim()
  const { data: myPerms } = useMyPermissions()
  const showCrmColumns = permissionSetHas(myPerms, PERMISSIONS.ORG_VIEW)
  const showTicketColumn = permissionSetHas(myPerms, PERMISSIONS.TICKET_VIEW_ALL)
  const columnCount = 5 + (showCrmColumns ? 1 : 0) + (showTicketColumn ? 1 : 0)
  const { data } = useSuspenseQuery(
    adminQueries.customerPeople({
      includeArchived: showArchived,
      limit: 100,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    })
  )

  return (
    <div className="rounded-md border border-border/50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            {showCrmColumns ? <TableHead>Organization</TableHead> : null}
            <TableHead>Portal</TableHead>
            <TableHead>Segments</TableHead>
            <TableHead className="text-right">Activity</TableHead>
            {showTicketColumn ? <TableHead className="text-right">Tickets</TableHead> : null}
            <TableHead className="w-24">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columnCount}
                className="py-6 text-center text-sm text-muted-foreground"
              >
                No people.
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((person) => {
              const label = person.name ?? person.email ?? person.id
              const personLink = person.contactId ? (
                <Link
                  to="/admin/contacts/people/$contactId"
                  params={{ contactId: person.contactId as ContactId }}
                  className="block truncate text-sm font-medium"
                >
                  {label}
                </Link>
              ) : (
                <Link
                  to="/admin/users"
                  search={{ selected: person.principalIds[0] as PrincipalId }}
                  className="block truncate text-sm font-medium"
                >
                  {label}
                </Link>
              )

              return (
                <TableRow key={person.id} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar src={person.avatarUrl} name={label} className="h-7 w-7 text-[10px]" />
                      <div className="min-w-0">
                        {personLink}
                        <div className="truncate text-xs text-muted-foreground">
                          {person.email ?? 'No email'}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  {showCrmColumns ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {person.organizationName ?? '—'}
                      {person.title ? (
                        <span className="block truncate text-[11px]">{person.title}</span>
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {person.hasPortalUser ? (
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">Portal user</Badge>
                        {person.emailVerified ? (
                          <Badge variant="outline">Verified</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Unverified
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Contact only
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {person.segments.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        person.segments.slice(0, 3).map((segment) => (
                          <Badge key={segment.id} variant="secondary" className="font-normal">
                            {segment.name}
                          </Badge>
                        ))
                      )}
                      {person.segments.length > 3 ? (
                        <Badge variant="outline">+{person.segments.length - 3}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatCount(person.postCount + person.commentCount + person.voteCount)}
                  </TableCell>
                  {showTicketColumn ? (
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatCount(person.ticketCount)}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {person.archivedAt ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Archived
                      </Badge>
                    ) : person.kind === 'linked' ? (
                      <Badge variant="outline">Linked</Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
