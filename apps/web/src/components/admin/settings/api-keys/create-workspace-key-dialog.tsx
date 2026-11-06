'use client'

import { useState, useTransition } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { DomainAccessPicker } from '@/components/domain-access-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createApiKeyFn } from '@/lib/server/functions/api-keys'
import { workspaceKeyRolesQuery } from './workspace-key-roles-query'
import {
  API_KEY_SCOPES,
  domainAccessLevels,
  scopesFromDomainLevels,
  type DomainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import type { ApiKey } from '@/lib/shared/types'
import { WorkspaceKeyRolePicker } from './workspace-key-role-picker'

const m = defineMessages({
  title: { id: 'apiKeys.workspace.createTitle', defaultMessage: 'Create workspace key' },
  description: {
    id: 'apiKeys.workspace.createDescription',
    defaultMessage:
      'For integrations. The key has its own role and keeps working when people leave.',
  },
  name: { id: 'apiKeys.form.name', defaultMessage: 'Name' },
  namePlaceholder: { id: 'apiKeys.workspace.namePlaceholder', defaultMessage: 'e.g. CRM sync' },
  role: { id: 'apiKeys.workspace.role', defaultMessage: 'Role' },
  access: { id: 'apiKeys.form.access', defaultMessage: 'Access' },
  accessHint: {
    id: 'apiKeys.workspace.accessHint',
    defaultMessage: 'The key can only do what its role allows and you select here.',
  },
  cancel: { id: 'apiKeys.form.cancel', defaultMessage: 'Cancel' },
  create: { id: 'apiKeys.form.create', defaultMessage: 'Create key' },
  creating: { id: 'apiKeys.form.creating', defaultMessage: 'Creating...' },
  failed: { id: 'apiKeys.form.createFailed', defaultMessage: 'The key could not be created.' },
})

interface CreateWorkspaceKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKeyCreated: (key: ApiKey, plainTextKey: string) => void
}

function defaultLevels(): DomainAccessLevels {
  return domainAccessLevels(API_KEY_SCOPES)
}

export function CreateWorkspaceKeyDialog({
  open,
  onOpenChange,
  onKeyCreated,
}: CreateWorkspaceKeyDialogProps) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const rolesQuery = useQuery({ ...workspaceKeyRolesQuery(), enabled: open })
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [levels, setLevels] = useState<DomainAccessLevels>(defaultLevels)
  const [error, setError] = useState<string | null>(null)

  const scopes = scopesFromDomainLevels(levels)
  const busy = saving || isPending

  const reset = () => {
    setName('')
    setRoleId('')
    setLevels(defaultLevels())
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !roleId || scopes.length === 0) return
    setError(null)
    setSaving(true)
    try {
      const result = await createApiKeyFn({ data: { name: name.trim(), scopes, roleId } })
      if (!result.ok) {
        setError(result.message)
        return
      }
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })
      reset()
      onKeyCreated(result.apiKey, result.plainTextKey)
    } catch {
      setError(intl.formatMessage(m.failed))
    } finally {
      setSaving(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage(m.title)}</DialogTitle>
          <DialogDescription>{intl.formatMessage(m.description)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-key-name">{intl.formatMessage(m.name)}</Label>
              <Input
                id="workspace-key-name"
                placeholder={intl.formatMessage(m.namePlaceholder)}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>{intl.formatMessage(m.role)}</Label>
              <WorkspaceKeyRolePicker
                roles={rolesQuery.data ?? []}
                value={roleId}
                onChange={setRoleId}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label>{intl.formatMessage(m.access)}</Label>
              <div className="overflow-hidden rounded-lg border border-border/50">
                <DomainAccessPicker
                  levels={levels}
                  onChange={setLevels}
                  disabled={busy}
                  flagHighImpact
                />
              </div>
              <p className="text-xs text-muted-foreground">{intl.formatMessage(m.accessHint)}</p>
            </div>
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
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              {intl.formatMessage(m.cancel)}
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !roleId || scopes.length === 0}>
              {intl.formatMessage(busy ? m.creating : m.create)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
