'use client'

import { useState, useTransition, useMemo } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ScopePicker } from '@/components/admin/settings/api-keys/scope-picker'
import { getRoleFn, setRolePermissionsFn } from '@/lib/server/functions/roles'
import type { RoleId } from '@quackback/ids'
import type { PermissionKey } from '@/lib/server/domains/authz'

interface Props {
  roleId: RoleId
  isSystem: boolean
}

const roleQuery = (id: RoleId) => ({
  queryKey: ['admin', 'roles', 'detail', id] as const,
  queryFn: () => getRoleFn({ data: { id } }),
})

/**
 * Read+edit grid for one role's permissions.
 * Parent should remount with `key={roleId}` when selected role changes.
 */
export function RolePermissionMatrix({ roleId, isSystem }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(roleQuery(roleId))
  const [isPending, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<string[]>(data.permissionKeys)

  const initialSet = useMemo(() => new Set(data.permissionKeys), [data.permissionKeys])
  const draftSet = useMemo(() => new Set(draft), [draft])
  const dirty =
    draft.length !== data.permissionKeys.length ||
    draft.some((k) => !initialSet.has(k as PermissionKey)) ||
    data.permissionKeys.some((k) => !draftSet.has(k))

  const handleSave = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await setRolePermissionsFn({
        data: { roleId, permissionKeys: draft as PermissionKey[] },
      })
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
        router.invalidate()
      })
    } catch (err) {
      console.error('Failed to save permissions:', err)
      setError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || isPending

  return (
    <div className="space-y-3">
      <ScopePicker
        value={draft}
        onChange={isSystem ? () => undefined : setDraft}
        disabled={isSystem || busy}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!isSystem && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDraft(data.permissionKeys)}
            disabled={!dirty || busy}
          >
            Reset
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save permissions'}
          </Button>
        </div>
      )}
    </div>
  )
}
