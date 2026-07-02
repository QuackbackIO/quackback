/**
 * Contacts belonging to an organization + Add-contact button.
 */
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { OrganizationId, ContactId } from '@quackback/ids'
import { contactQueries } from '@/lib/client/queries/contacts'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PlusIcon } from '@heroicons/react/24/solid'
import { ContactCreateDialog } from '@/components/admin/contacts/contact-create-dialog'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export function OrganizationContactsTab({ organizationId }: { organizationId: OrganizationId }) {
  const { data: contacts } = useSuspenseQuery(
    contactQueries.byOrg(organizationId, { includeArchived: false })
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <PermissionGate permission={PERMISSIONS.ORG_MANAGE}>
          <ContactCreateDialog
            defaultOrganizationId={organizationId}
            trigger={
              <Button size="sm">
                <PlusIcon className="h-4 w-4 mr-1" />
                Add contact
              </Button>
            }
          />
        </PermissionGate>
      </div>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  No contacts in this organization yet.
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
                  <TableCell className="text-xs text-muted-foreground">{c.phone ?? '—'}</TableCell>
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
    </div>
  )
}
