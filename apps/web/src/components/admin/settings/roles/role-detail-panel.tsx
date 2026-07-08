'use client'

import { useState, Suspense } from 'react'
import { LockClosedIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RolePermissionMatrix } from './role-permission-matrix'
import { RoleEditDialog } from './role-edit-dialog'
import { DeleteRoleDialog } from './delete-role-dialog'
import type { RoleListItem } from '@/lib/server/domains/authz/role.service'

interface Props {
  role: RoleListItem
}

export function RoleDetailPanel({ role }: Props) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {role.isSystem && <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />}
            <h2 className="text-base font-semibold truncate">{role.name}</h2>
            {role.isSystem && (
              <Badge variant="outline" className="text-[10px]">
                System
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <code className="font-mono">{role.key}</code>
            <span>·</span>
            <span>
              {role.assignmentCount} assignment{role.assignmentCount === 1 ? '' : 's'}
            </span>
          </div>
          {role.description && (
            <p className="text-xs text-muted-foreground pt-1">{role.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            disabled={role.isSystem}
            aria-label={`Edit ${role.name}`}
          >
            <PencilIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            disabled={role.isSystem}
            aria-label={`Delete ${role.name}`}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Suspense
        fallback={<div className="text-xs text-muted-foreground">Loading permissions…</div>}
      >
        <RolePermissionMatrix key={role.id} roleId={role.id} isSystem={role.isSystem} />
      </Suspense>

      {!role.isSystem && (
        <>
          <RoleEditDialog open={editOpen} onOpenChange={setEditOpen} role={role} />
          <DeleteRoleDialog open={deleteOpen} onOpenChange={setDeleteOpen} role={role} />
        </>
      )}
    </div>
  )
}
