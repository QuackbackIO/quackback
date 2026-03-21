import { Fragment, useState, useEffect, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  type ColumnDef,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { BackLink } from '@/components/ui/back-link'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { EnvelopeIcon } from '@heroicons/react/24/solid'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SearchInput } from '@/components/shared/search-input'
import { FormError } from '@/components/shared/form-error'
import { TeamHeader } from '@/components/admin/settings/team/team-header'
import {
  type PendingInvitation,
  getExpiryText,
  formatInviteDate,
  InvitationActions,
  InviteLinkRow,
} from '@/components/admin/settings/team/pending-invitations'
import { MemberActions } from '@/components/admin/settings/team/member-actions'
import type { UserId, PrincipalId } from '@quackback/ids'
import { isAdmin } from '@/lib/shared/roles'

// Discriminated union: each row is either a member or an invitation
type TeamRow =
  | {
      type: 'member'
      id: string
      name: string
      email: string | null
      role: string
      userId: UserId | null
      principalId: PrincipalId
    }
  | {
      type: 'invitation'
      id: string
      name: string | null
      email: string
      role: string | null
      createdAt: string
      lastSentAt: string | null
      expiresAt: string
    }

const teamFilterFn: FilterFn<TeamRow> = (row, _columnId, filterValue: string) => {
  const query = filterValue.toLowerCase()
  const r = row.original
  const name = r.type === 'member' ? r.name : r.name || ''
  return (
    name.toLowerCase().includes(query) ||
    (r.email?.toLowerCase().includes(query) ?? false) ||
    (r.role?.toLowerCase().includes(query) ?? false)
  )
}

export const Route = createFileRoute('/admin/settings/team')({
  loader: async ({ context }) => {
    const { settings, queryClient, principal } = context
    await queryClient.ensureQueryData(settingsQueries.teamMembersAndInvitations())

    return {
      settings,
      currentMember: principal as { id: PrincipalId; role: 'admin' | 'member'; userId: UserId },
    }
  },
  component: TeamPage,
})

function TeamPage() {
  const { settings, currentMember } = Route.useLoaderData()
  const teamDataQuery = useSuspenseQuery(settingsQueries.teamMembersAndInvitations())
  const { members, avatarMap, formattedInvitations } = teamDataQuery.data

  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [inviteLinkMap, setInviteLinkMap] = useState<Record<string, string>>({})

  // Local invitation state for optimistic updates
  const [invitations, setInvitations] = useState<PendingInvitation[]>(formattedInvitations)
  useEffect(() => {
    setInvitations(formattedInvitations)
  }, [formattedInvitations])

  const adminCount = members.filter((m) => isAdmin(m.role)).length
  const isLastAdmin = adminCount <= 1
  const isCurrentUserAdmin = isAdmin(currentMember.role)

  // Merge members + invitations into a unified list (members first)
  const data = useMemo<TeamRow[]>(() => {
    const memberRows: TeamRow[] = members.map((m) => ({
      type: 'member' as const,
      id: m.id,
      name: m.userName,
      email: m.userEmail,
      role: m.role,
      userId: m.userId,
      principalId: m.id,
    }))
    const invitationRows: TeamRow[] = invitations.map((inv) => ({
      type: 'invitation' as const,
      id: inv.id,
      name: inv.name,
      email: inv.email,
      role: inv.role,
      createdAt: inv.createdAt,
      lastSentAt: inv.lastSentAt,
      expiresAt: inv.expiresAt,
    }))
    return [...memberRows, ...invitationRows]
  }, [members, invitations])

  const handleResent = (id: string, lastSentAt: string) => {
    setInvitations((prev) => prev.map((inv) => (inv.id === id ? { ...inv, lastSentAt } : inv)))
  }

  const handleCancelled = (id: string) => {
    setInvitations((prev) => prev.filter((inv) => inv.id !== id))
  }

  const handleInviteLink = (id: string, link: string) => {
    setInviteLinkMap((prev) => ({ ...prev, [id]: link }))
  }

  const columns = useMemo<ColumnDef<TeamRow>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (row) =>
          `${row.type === 'member' ? row.name : row.name || ''} ${row.email || ''} ${row.role || ''}`,
        header: 'Name',
        cell: ({ row }) => {
          const r = row.original
          if (r.type === 'member') {
            const avatarUrl = r.userId ? avatarMap[r.userId] : null
            const isCurrentUser = r.principalId === currentMember.id
            return (
              <div className="flex items-center gap-3">
                <Avatar src={avatarUrl} name={r.name} />
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {r.name}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  {r.email && <p className="text-sm text-muted-foreground truncate">{r.email}</p>}
                </div>
              </div>
            )
          }

          // Invitation row
          const expiry = getExpiryText(r.expiresAt)
          return (
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <EnvelopeIcon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">
                  {r.name || r.email}
                  <Badge
                    variant="outline"
                    className="ml-2 bg-amber-500/10 text-amber-600 border-amber-500/30"
                  >
                    Invited
                  </Badge>
                </p>
                {r.name && <p className="text-sm text-muted-foreground truncate">{r.email}</p>}
                <p className="text-xs text-muted-foreground">
                  Sent {formatInviteDate(r.lastSentAt || r.createdAt)}
                  <span className="mx-1">&middot;</span>
                  <span className={expiry.className}>{expiry.text}</span>
                </p>
              </div>
            </div>
          )
        },
      },
      {
        id: 'role',
        header: 'Role',
        meta: { className: 'w-0 whitespace-nowrap' },
        cell: ({ row }) => {
          const r = row.original
          const role = r.role || 'member'
          return (
            <Badge
              variant="outline"
              className={
                isAdmin(role) ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted/50'
              }
            >
              {role}
            </Badge>
          )
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'w-0 whitespace-nowrap' },
        cell: ({ row }) => {
          const r = row.original

          if (r.type === 'invitation') {
            return (
              <InvitationActions
                invitation={r}
                onResent={handleResent}
                onCancelled={handleCancelled}
                onError={setError}
                onInviteLink={handleInviteLink}
              />
            )
          }

          // Member row
          const isCurrentUser = r.principalId === currentMember.id
          const showActions = isCurrentUserAdmin && !isCurrentUser
          if (!showActions) return null

          return (
            <div className="flex justify-end">
              <MemberActions
                principalId={r.principalId}
                memberName={r.name || r.email || 'Unnamed'}
                memberRole={r.role as 'admin' | 'member'}
                isLastAdmin={isLastAdmin && isAdmin(r.role)}
              />
            </div>
          )
        },
      },
    ],
    [avatarMap, currentMember.id, isCurrentUserAdmin, isLastAdmin]
  )

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: teamFilterFn,
    state: { globalFilter: search },
    onGlobalFilterChange: setSearch,
    getRowId: (row) => row.id,
  })

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <TeamHeader workspaceName={settings!.name} />

      {error && <FormError message={error} />}

      <div className="rounded-xl border border-border/50 bg-card shadow-sm">
        <div className="px-4 pt-4 pb-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by name, email, or role..."
          />
        </div>

        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={(header.column.columnDef.meta as { className?: string })?.className}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {data.length === 0 ? 'No team members yet' : 'No results found'}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const r = row.original
                const inviteLink = r.type === 'invitation' ? inviteLinkMap[r.id] : undefined

                return (
                  <Fragment key={row.id}>
                    <TableRow>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={
                            (cell.column.columnDef.meta as { className?: string })?.className
                          }
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {inviteLink && <InviteLinkRow link={inviteLink} colSpan={columns.length} />}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
