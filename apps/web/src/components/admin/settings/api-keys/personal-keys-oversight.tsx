'use client'

import { lazy, Suspense, useState, useTransition } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { KeyTable, KeyTableCell, KeyTableHead } from './key-table'
import { formatDistanceToNow } from 'date-fns'
import { revokeApiKeyFn } from '@/lib/server/functions/api-keys'
import { setPersonalKeyPolicyFn } from '@/lib/server/functions/personal-key-policy'
import type { ManagedApiKey } from '@/lib/server/domains/api-keys/api-key.types'
import { summarizeDomainAccess } from '@/lib/shared/api-key-scopes'
import type { ApiKey } from '@/lib/shared/types'
import { creatorLabel, ExpiredTag, isKeyExpired, LONG_DATE } from './key-labels'

// Loads when first opened.
const RevokeApiKeyDialog = lazy(() =>
  import('./key-dialogs').then((mod) => ({ default: mod.RevokeApiKeyDialog }))
)

const m = defineMessages({
  title: { id: 'apiKeys.personal.title', defaultMessage: 'Personal keys' },
  description: {
    id: 'apiKeys.personal.description',
    defaultMessage:
      'Keys that teammates made for themselves. Each key acts as the teammate who made it.',
  },
  policy: {
    id: 'apiKeys.personal.policy',
    defaultMessage: 'Teammates can create personal API keys',
  },
  policyDescription: {
    id: 'apiKeys.personal.policyDescription',
    defaultMessage: 'Turning this off stops new keys. Existing keys keep working.',
  },
  empty: { id: 'apiKeys.personal.empty', defaultMessage: 'No personal keys yet' },
  key: { id: 'apiKeys.column.key', defaultMessage: 'Key' },
  teammate: { id: 'apiKeys.column.teammate', defaultMessage: 'Teammate' },
  scopes: { id: 'apiKeys.column.scopes', defaultMessage: 'Scopes' },
  expires: { id: 'apiKeys.column.expires', defaultMessage: 'Expires' },
  lastUsed: { id: 'apiKeys.column.lastUsed', defaultMessage: 'Last used' },
  actions: { id: 'apiKeys.column.actions', defaultMessage: 'Actions' },
  never: { id: 'apiKeys.never', defaultMessage: 'Never' },
  noExpiry: { id: 'apiKeys.noExpiry', defaultMessage: 'No expiry' },
  revoke: { id: 'apiKeys.action.revoke', defaultMessage: 'Revoke' },
  expired: { id: 'apiKeys.expired', defaultMessage: 'Expired' },
  revokeLabel: { id: 'apiKeys.personal.revokeLabel', defaultMessage: 'Revoke {name}' },
  settingsRead: { id: 'apiKeys.scopes.settingsReadSummary', defaultMessage: 'Settings (read)' },
  settingsReadWrite: {
    id: 'apiKeys.scopes.settingsReadWriteSummary',
    defaultMessage: 'Settings (read and write)',
  },
})

const revoke = (id: ApiKey['id']) => revokeApiKeyFn({ data: { id } })

/**
 * Every teammate's personal keys, which a key manager may revoke but never
 * rotate, and the switch that lets teammates make them.
 */
export function PersonalKeysOversight({
  apiKeys,
  policyEnabled,
}: {
  apiKeys: ManagedApiKey[]
  policyEnabled: boolean
}) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(policyEnabled)
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState<ManagedApiKey | null>(null)

  const savePolicy = async (next: boolean) => {
    setEnabled(next)
    setSaving(true)
    try {
      const result = await setPersonalKeyPolicyFn({ data: { enabled: next } })
      setEnabled(result.enabled)
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })
    } catch {
      setEnabled(!next)
    } finally {
      setSaving(false)
    }
  }

  const scopesOf = (key: ManagedApiKey) =>
    summarizeDomainAccess(key.scopes, (level) =>
      intl.formatMessage(level === 'read' ? m.settingsRead : m.settingsReadWrite)
    )

  return (
    <>
      <SettingsCard
        title={intl.formatMessage(m.title)}
        description={intl.formatMessage(m.description)}
        flush
      >
        <div className="border-b border-border/50 px-4 sm:px-6">
          <SettingRow
            label={intl.formatMessage(m.policy)}
            description={intl.formatMessage(m.policyDescription)}
            htmlFor="personal-api-keys-policy"
            control={
              <Switch
                id="personal-api-keys-policy"
                checked={enabled}
                disabled={saving}
                onCheckedChange={(next) => void savePolicy(next)}
                aria-label={intl.formatMessage(m.policy)}
              />
            }
          />
        </div>
        {apiKeys.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-6">
            {intl.formatMessage(m.empty)}
          </p>
        ) : (
          <KeyTable>
            <thead>
              <tr>
                <KeyTableHead className="pl-4 sm:pl-6">{intl.formatMessage(m.key)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.teammate)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.scopes)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.expires)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.lastUsed)}</KeyTableHead>
                <KeyTableHead className="pr-4 sm:pr-6">
                  <span className="sr-only">{intl.formatMessage(m.actions)}</span>
                </KeyTableHead>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((key) => (
                <tr key={key.id}>
                  <KeyTableCell className="pl-4 font-medium sm:pl-6">
                    <span className="flex items-center gap-2">
                      {key.name}
                      {isKeyExpired(key) && <ExpiredTag label={intl.formatMessage(m.expired)} />}
                    </span>
                  </KeyTableCell>
                  <KeyTableCell>{creatorLabel(intl, key)}</KeyTableCell>
                  <KeyTableCell className="whitespace-normal text-muted-foreground">
                    {scopesOf(key)}
                  </KeyTableCell>
                  <KeyTableCell className="text-muted-foreground">
                    {key.expiresAt
                      ? intl.formatDate(key.expiresAt, LONG_DATE)
                      : intl.formatMessage(m.noExpiry)}
                  </KeyTableCell>
                  <KeyTableCell className="text-muted-foreground">
                    {key.lastUsedAt
                      ? formatDistanceToNow(key.lastUsedAt, { addSuffix: true })
                      : intl.formatMessage(m.never)}
                  </KeyTableCell>
                  <KeyTableCell className="pr-4 text-right sm:pr-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={intl.formatMessage(m.revokeLabel, { name: key.name })}
                      onClick={() => setRevoking(key)}
                    >
                      {intl.formatMessage(m.revoke)}
                    </Button>
                  </KeyTableCell>
                </tr>
              ))}
            </tbody>
          </KeyTable>
        )}
      </SettingsCard>

      {revoking && (
        <Suspense fallback={null}>
          <RevokeApiKeyDialog
            open
            onOpenChange={(next) => !next && setRevoking(null)}
            apiKey={revoking}
            revoke={revoke}
          />
        </Suspense>
      )}
    </>
  )
}
