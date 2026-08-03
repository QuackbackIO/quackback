'use client'

import { useState, useEffect } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { RoleList } from './role-list'
import { RoleDetailPanel } from './role-detail-panel'
import { RoleCreateDialog } from './role-create-dialog'
import type { RoleListItem } from '@/lib/server/domains/authz/role.service'
import type { RoleId } from '@quackback/ids'

interface Props {
  roles: RoleListItem[]
}

export function RolesSettings({ roles }: Props) {
  const [selectedId, setSelectedId] = useState<RoleId | null>(roles[0]?.id ?? null)
  const [createOpen, setCreateOpen] = useState(false)

  // Re-anchor selection if the currently-selected role disappears (delete).
  useEffect(() => {
    if (!selectedId) {
      setSelectedId(roles[0]?.id ?? null)
      return
    }
    const stillExists = roles.some((r) => r.id === selectedId)
    if (!stillExists) setSelectedId(roles[0]?.id ?? null)
  }, [roles, selectedId])

  const selected = roles.find((r) => r.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="h-4 w-4 mr-1.5" />
          Create role
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        <RoleList roles={roles} selectedId={selectedId} onSelect={setSelectedId} />
        {selected ? (
          <RoleDetailPanel role={selected} />
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-xs text-muted-foreground">
            No role selected.
          </div>
        )}
      </div>

      <RoleCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  )
}
