'use client'

import { useState, useTransition } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { setWorkspaceKeyRoleFn } from '@/lib/server/functions/api-keys'
import { workspaceKeyRolesQuery } from './workspace-key-roles-query'
import type { ManagedApiKey } from '@/lib/server/domains/api-keys/api-key.types'
import { WorkspaceKeyRolePicker } from './workspace-key-role-picker'
import { ADMIN_KEY_MESSAGES, refusalText } from './key-messages'

const m = defineMessages({
  title: { id: 'apiKeys.changeRole.title', defaultMessage: 'Change role' },
  description: {
    id: 'apiKeys.changeRole.description',
    defaultMessage: 'The key can do what its new role allows from its next request.',
  },
  cancel: { id: 'apiKeys.form.cancel', defaultMessage: 'Cancel' },
  save: { id: 'apiKeys.form.save', defaultMessage: 'Save' },
  failed: { id: 'apiKeys.form.saveFailed', defaultMessage: 'The change could not be saved.' },
})

/** Give a workspace key a different role, within the caller's own permissions. */
export function ChangeKeyRoleDialog({
  open,
  onOpenChange,
  apiKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: Pick<ManagedApiKey, 'id' | 'name' | 'role'>
}) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const rolesQuery = useQuery({ ...workspaceKeyRolesQuery(), enabled: open })
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [roleId, setRoleId] = useState(apiKey.role?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const busy = saving || isPending

  const handleSave = async () => {
    if (!roleId) return
    setError(null)
    setSaving(true)
    try {
      const result = await setWorkspaceKeyRoleFn({ data: { id: apiKey.id, roleId } })
      if (!result.ok) {
        setError(refusalText(intl, ADMIN_KEY_MESSAGES, result.code))
        return
      }
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })
      onOpenChange(false)
    } catch {
      setError(intl.formatMessage(m.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage(m.title)}</DialogTitle>
          <DialogDescription>{intl.formatMessage(m.description)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <WorkspaceKeyRolePicker
            roles={rolesQuery.data ?? []}
            value={roleId}
            onChange={setRoleId}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {intl.formatMessage(m.cancel)}
          </Button>
          <Button onClick={handleSave} disabled={busy || !roleId || roleId === apiKey.role?.id}>
            {intl.formatMessage(m.save)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
