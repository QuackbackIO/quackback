'use client'

import { lazy, Suspense, useState } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { KeyIcon } from '@heroicons/react/24/solid'
import { PortalPageHeader } from '@/components/public/portal-page-header'
import { NewButton } from '@/components/shared/new-button'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { ApiKeyRevealDialog } from '@/components/admin/settings/api-keys/api-key-reveal-dialog'
import { RevokeApiKeyDialog } from '@/components/admin/settings/api-keys/revoke-api-key-dialog'
import { RotateApiKeyDialog } from '@/components/admin/settings/api-keys/rotate-api-key-dialog'
import { TimeAgo } from '@/components/ui/time-ago'
import { revokeMyApiKeyFn, rotateMyApiKeyFn } from '@/lib/server/functions/personal-api-keys'
import { summarizeDomainAccess } from '@/lib/shared/api-key-scopes'
import type { ApiKey } from '@/lib/shared/types'

// The form loads when first opened.
const CreatePersonalKeyDialog = lazy(() =>
  import('./create-personal-key-dialog').then((mod) => ({
    default: mod.CreatePersonalKeyDialog,
  }))
)

const m = defineMessages({
  title: { id: 'portal.settings.apiKeys.title', defaultMessage: 'API keys' },
  actsAsYou: {
    id: 'portal.settings.apiKeys.actsAsYou',
    defaultMessage: 'Keys act as you. They can see and do what you can.',
  },
  newKey: { id: 'portal.settings.apiKeys.new', defaultMessage: 'New key' },
  policyOff: {
    id: 'portal.settings.apiKeys.policyOff',
    defaultMessage: 'Your admin has turned off new personal keys.',
  },
  empty: { id: 'portal.settings.apiKeys.empty', defaultMessage: 'You have no API keys yet.' },
  footer: {
    id: 'portal.settings.apiKeys.footer',
    defaultMessage:
      'Shown only once, when created. A key stops working if you leave the workspace.',
  },
  expires: { id: 'portal.settings.apiKeys.expiresDate', defaultMessage: 'Expires {date}' },
  noExpiry: { id: 'portal.settings.apiKeys.noExpiry', defaultMessage: 'No expiry' },
  lastUsed: { id: 'portal.settings.apiKeys.lastUsed', defaultMessage: 'Last used {time}' },
  neverUsed: { id: 'portal.settings.apiKeys.neverUsed', defaultMessage: 'Never used' },
  rotate: { id: 'portal.settings.apiKeys.rotate', defaultMessage: 'Rotate' },
  revoke: { id: 'portal.settings.apiKeys.revoke', defaultMessage: 'Revoke' },
  settingsRead: { id: 'apiKeys.scopes.settingsReadSummary', defaultMessage: 'Settings (read)' },
  settingsReadWrite: {
    id: 'apiKeys.scopes.settingsReadWriteSummary',
    defaultMessage: 'Settings (read and write)',
  },
})

const rotate = (id: ApiKey['id']) => rotateMyApiKeyFn({ data: { id } })
const revoke = (id: ApiKey['id']) => revokeMyApiKeyFn({ data: { id } })

/** /settings/api-keys: the signed-in teammate's own personal keys. */
export function PersonalApiKeys({ apiKeys, canCreate }: { apiKeys: ApiKey[]; canCreate: boolean }) {
  const intl = useIntl()
  const [createOpen, setCreateOpen] = useState(false)
  const [createOpened, setCreateOpened] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null)
  const [selected, setSelected] = useState<ApiKey | null>(null)
  const [dialog, setDialog] = useState<'rotate' | 'revoke' | null>(null)

  const reveal = (key: ApiKey, plainTextKey: string) => {
    setRevealed({ name: key.name, value: plainTextKey })
    setCreateOpen(false)
    setDialog(null)
    setRevealOpen(true)
  }

  const meta = (key: ApiKey) => {
    const expiry = key.expiresAt
      ? intl.formatMessage(m.expires, {
          date: intl.formatDate(key.expiresAt, { dateStyle: 'medium' }),
        })
      : intl.formatMessage(m.noExpiry)
    return (
      <>
        <code className="font-mono text-xs">{key.keyPrefix}...</code>
        {' · '}
        {expiry}
        {' · '}
        {key.lastUsedAt
          ? intl.formatMessage(m.lastUsed, { time: <TimeAgo date={key.lastUsedAt} /> })
          : intl.formatMessage(m.neverUsed)}
        <span className="block whitespace-normal">
          {summarizeDomainAccess(key.scopes, (level) =>
            intl.formatMessage(level === 'read' ? m.settingsRead : m.settingsReadWrite)
          )}
        </span>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PortalPageHeader
        icon={KeyIcon}
        title={intl.formatMessage(m.title)}
        description={intl.formatMessage(m.actsAsYou)}
        action={
          <NewButton
            noun="key"
            disabled={!canCreate}
            onClick={() => {
              setCreateOpened(true)
              setCreateOpen(true)
            }}
          >
            {intl.formatMessage(m.newKey)}
          </NewButton>
        }
        animate
      />

      {!canCreate && (
        <p className="text-sm text-muted-foreground">{intl.formatMessage(m.policyOff)}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm">
        {apiKeys.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            {intl.formatMessage(m.empty)}
          </p>
        ) : (
          <SettingsList>
            {apiKeys.map((key) => (
              <SettingsListRow
                key={key.id}
                leading={<RowIcon icon={KeyIcon} />}
                title={key.name}
                meta={meta(key)}
                actions={[
                  {
                    label: intl.formatMessage(m.rotate),
                    onSelect: () => {
                      setSelected(key)
                      setDialog('rotate')
                    },
                  },
                  {
                    label: intl.formatMessage(m.revoke),
                    destructive: true,
                    onSelect: () => {
                      setSelected(key)
                      setDialog('revoke')
                    },
                  },
                ]}
              />
            ))}
          </SettingsList>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{intl.formatMessage(m.footer)}</p>

      {createOpened && (
        <Suspense fallback={null}>
          <CreatePersonalKeyDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onKeyCreated={reveal}
          />
        </Suspense>
      )}

      <ApiKeyRevealDialog
        open={revealOpen}
        onOpenChange={setRevealOpen}
        keyValue={revealed?.value ?? null}
        keyName={revealed?.name ?? ''}
        onClose={() => setRevealed(null)}
      />

      {selected && (
        <>
          <RotateApiKeyDialog
            open={dialog === 'rotate'}
            onOpenChange={(next) => setDialog(next ? 'rotate' : null)}
            apiKey={selected}
            rotate={rotate}
            onKeyRotated={reveal}
          />
          <RevokeApiKeyDialog
            open={dialog === 'revoke'}
            onOpenChange={(next) => setDialog(next ? 'revoke' : null)}
            apiKey={selected}
            revoke={revoke}
          />
        </>
      )}
    </div>
  )
}
