'use client'

import { useState, useTransition } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { DomainAccessPicker } from '@/components/domain-access-picker'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createApiKeyFn } from '@/lib/server/functions/api-keys'
import {
  API_KEY_SCOPES,
  domainAccessLevels,
  scopesFromDomainLevels,
  type DomainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import { ApiKeyRevealDialog } from './api-key-reveal-dialog'
import { ADMIN_KEY_MESSAGES, refusalText } from './key-messages'
import { WorkspaceKeyRolePicker } from './workspace-key-role-picker'
import { workspaceKeyRolesQuery } from './workspace-key-roles-query'

const m = defineMessages({
  title: { id: 'apiKeys.workspace.new', defaultMessage: 'New workspace key' },
  description: {
    id: 'apiKeys.workspace.createDescription',
    defaultMessage:
      'For integrations. The key has its own role and keeps working when people leave.',
  },
  developers: { id: 'apiKeys.workspace.developersCrumb', defaultMessage: 'Developers' },
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

const KEYS_TAB = { to: '/admin/settings/developers', search: { tab: 'keys' } } as const

/** /admin/settings/developers/workspace-keys/new: name, role and access for a new workspace key. */
export function CreateWorkspaceKeyPage() {
  const intl = useIntl()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const rolesQuery = useQuery(workspaceKeyRolesQuery())
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [levels, setLevels] = useState<DomainAccessLevels>(() => domainAccessLevels(API_KEY_SCOPES))
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; value: string } | null>(null)

  const scopes = scopesFromDomainLevels(levels)
  const busy = saving || isPending
  const backToKeys = () => void navigate(KEYS_TAB)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !roleId || scopes.length === 0) return
    setError(null)
    setSaving(true)
    try {
      const result = await createApiKeyFn({ data: { name: name.trim(), scopes, roleId } })
      if (!result.ok) {
        setError(refusalText(intl, ADMIN_KEY_MESSAGES, result.code))
        return
      }
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })
      setCreated({ name: result.apiKey.name, value: result.plainTextKey })
    } catch {
      setError(intl.formatMessage(m.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage
      title={intl.formatMessage(m.title)}
      description={intl.formatMessage(m.description)}
      crumbs={[{ label: intl.formatMessage(m.developers), to: '/admin/settings/developers' }]}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <SettingsCard>
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="workspace-key-name">{intl.formatMessage(m.name)}</Label>
              <Input
                id="workspace-key-name"
                className="max-w-sm"
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
        </SettingsCard>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={backToKeys} disabled={busy}>
            {intl.formatMessage(m.cancel)}
          </Button>
          <Button type="submit" disabled={busy || !name.trim() || !roleId || scopes.length === 0}>
            {intl.formatMessage(busy ? m.creating : m.create)}
          </Button>
        </div>
      </form>

      <ApiKeyRevealDialog
        open={created !== null}
        onOpenChange={(open) => !open && setCreated(null)}
        keyValue={created?.value ?? null}
        keyName={created?.name ?? ''}
        onClose={backToKeys}
      />
    </SettingsPage>
  )
}
