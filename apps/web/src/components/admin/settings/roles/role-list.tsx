'use client'

import { LockClosedIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import type { RoleListItem } from '@/lib/server/domains/authz/role.service'
import type { RoleId } from '@quackback/ids'

interface Props {
  roles: RoleListItem[]
  selectedId: RoleId | null
  onSelect: (id: RoleId) => void
}

export function RoleList({ roles, selectedId, onSelect }: Props) {
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <ul className="divide-y divide-border/50">
        {roles.map((r) => {
          const active = r.id === selectedId
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                className={cn(
                  'w-full text-left px-3 py-2 transition-colors hover:bg-muted/50',
                  active && 'bg-muted'
                )}
              >
                <div className="flex items-center gap-1.5">
                  {r.isSystem && (
                    <LockClosedIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{r.name}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <code className="font-mono">{r.key}</code>
                  <span>·</span>
                  <span>{r.permissionCount} perms</span>
                  <span>·</span>
                  <span>{r.assignmentCount} assigned</span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
