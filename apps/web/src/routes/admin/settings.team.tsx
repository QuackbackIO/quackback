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
import { CopyButton } from '@/components/shared/copy-button'
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
      /** ISO 8601 from the server; null when the user has never
       *  signed in (or all sessions have aged out). Rendered as
       *  "2 hours ago" / "Never" in the table. */
      lastSignInAt: string | null
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
      lastSignInAt: m.lastSignInAt,
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
        id: 'lastSignIn',
        header: 'Last sign-in',
        meta: { className: 'w-0 whitespace-nowrap text-xs text-muted-foreground' },
        cell: ({ row }) => {
          const r = row.original
          // Invitation rows have their own time info inline with the
          // name; skip the column.
          if (r.type !== 'member') return null
          if (!r.lastSignInAt) return <span className="text-muted-foreground">Never</span>
          const date = new Date(r.lastSignInAt)
          // Days-ago is enough granularity for a team list; the audit
          // log has the timestamp if anyone needs the exact moment.
          const daysAgo = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000))
          const label =
            daysAgo === 0
              ? 'Today'
              : daysAgo === 1
                ? 'Yesterday'
                : daysAgo < 30
                  ? `${daysAgo}d ago`
                  : date.toLocaleDateString()
          return <span title={date.toLocaleString()}>{label}</span>
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
                userId={r.userId}
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

        {/* md+: standard table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={
                        (header.column.columnDef.meta as { className?: string })?.className
                      }
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

        {/* below md: stacked member cards */}
        <div className="md:hidden divide-y divide-border/50">
          {table.getRowModel().rows.length === 0 ? (
            <p className="h-24 flex items-center justify-center text-muted-foreground text-sm">
              {data.length === 0 ? 'No team members yet' : 'No results found'}
            </p>
          ) : (
            table.getRowModel().rows.map((row) => {
              const r = row.original
              const inviteLink = r.type === 'invitation' ? inviteLinkMap[r.id] : undefined
              const role = r.role || 'member'
              const isCurrentUser = r.type === 'member' && r.principalId === currentMember.id
              const showActions = r.type === 'invitation' || (isCurrentUserAdmin && !isCurrentUser)

              return (
                <Fragment key={row.id}>
                  <div className="p-4 space-y-3">
                    {/* Primary identifier */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {r.type === 'member' ? (
                          <Avatar src={r.userId ? avatarMap[r.userId] : null} name={r.name} />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <EnvelopeIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">
                            {r.type === 'member' ? r.name : r.name || r.email}
                            {isCurrentUser && (
                              <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                            )}
                            {r.type === 'invitation' && (
                              <Badge
                                variant="outline"
                                className="ml-2 bg-amber-500/10 text-amber-600 border-amber-500/30"
                              >
                                Invited
                              </Badge>
                            )}
                          </p>
                          {r.email && (
                            <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          isAdmin(role)
                            ? 'bg-primary/10 text-primary border-primary/30 shrink-0'
                            : 'bg-muted/50 shrink-0'
                        }
                      >
                        {role}
                      </Badge>
                    </div>

                    {/* Secondary: last sign-in or invite expiry */}
                    {r.type === 'member' && (
                      <p className="text-xs text-muted-foreground">
                        {r.lastSignInAt
                          ? (() => {
                              const date = new Date(r.lastSignInAt)
                              const daysAgo = Math.floor(
                                (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)
                              )
                              const label =
                                daysAgo === 0
                                  ? 'Today'
                                  : daysAgo === 1
                                    ? 'Yesterday'
                                    : daysAgo < 30
                                      ? `${daysAgo}d ago`
                                      : date.toLocaleDateString()
                              return `Last sign-in: ${label}`
                            })()
                          : 'Never signed in'}
                      </p>
                    )}
                    {r.type === 'invitation' && (
                      <p className="text-xs text-muted-foreground">
                        Sent {formatInviteDate(r.lastSentAt || r.createdAt)}
                        <span className="mx-1">&middot;</span>
                        <span className={getExpiryText(r.expiresAt).className}>
                          {getExpiryText(r.expiresAt).text}
                        </span>
                      </p>
                    )}

                    {/* Actions */}
                    {showActions && (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        {r.type === 'invitation' ? (
                          <InvitationActions
                            invitation={r}
                            onResent={handleResent}
                            onCancelled={handleCancelled}
                            onError={setError}
                            onInviteLink={handleInviteLink}
                          />
                        ) : (
                          <MemberActions
                            principalId={r.principalId}
                            userId={r.userId}
                            memberName={r.name || r.email || 'Unnamed'}
                            memberRole={r.role as 'admin' | 'member'}
                            isLastAdmin={isLastAdmin && isAdmin(r.role)}
                          />
                        )}
                      </div>
                    )}

                    {inviteLink && (
                      <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2">
                        <code className="flex-1 truncate text-xs">{inviteLink}</code>
                        <CopyButton value={inviteLink} variant="ghost" size="sm" />
                      </div>
                    )}
                  </div>
                </Fragment>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
