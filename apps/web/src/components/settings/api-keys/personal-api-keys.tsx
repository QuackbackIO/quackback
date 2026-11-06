'use client'

import { lazy, Suspense, useState } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { PortalPageHeader } from '@/components/public/portal-page-header'
import { KeyGlyph } from '@/components/settings/settings-nav'
import { NewButton } from '@/components/shared/new-button'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { LocalDate } from '@/components/ui/local-date'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  renameMyApiKeyFn,
  revokeMyApiKeyFn,
  rotateMyApiKeyFn,
} from '@/lib/server/functions/personal-api-keys'
import { Badge } from '@/components/ui/badge'
import { isKeyExpired, PORTAL_KEY_MESSAGES, summarizeScopes } from './portal-key-messages'
import type { ApiKey } from '@/lib/shared/types'

// Each dialog loads when first opened.
const ApiKeyRevealDialog = lazy(() =>
  import('@/components/admin/settings/api-keys/key-dialogs').then((mod) => ({
    default: mod.ApiKeyRevealDialog,
  }))
)
const RevokeApiKeyDialog = lazy(() =>
  import('@/components/admin/settings/api-keys/key-dialogs').then((mod) => ({
    default: mod.RevokeApiKeyDialog,
  }))
)
const RotateApiKeyDialog = lazy(() =>
  import('@/components/admin/settings/api-keys/key-dialogs').then((mod) => ({
    default: mod.RotateApiKeyDialog,
  }))
)
const RenameApiKeyDialog = lazy(() =>
  import('@/components/admin/settings/api-keys/key-dialogs').then((mod) => ({
    default: mod.RenameApiKeyDialog,
  }))
)
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
  rename: { id: 'portal.settings.apiKeys.rename', defaultMessage: 'Rename' },
  rotate: { id: 'portal.settings.apiKeys.rotate', defaultMessage: 'Rotate' },
  revoke: { id: 'portal.settings.apiKeys.revoke', defaultMessage: 'Revoke' },
  expired: { id: 'portal.settings.apiKeys.expired', defaultMessage: 'Expired' },
})

/** "Feb 4, 2027" */
const EXPIRY_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const rotate = (id: ApiKey['id']) => rotateMyApiKeyFn({ data: { id } })
const revoke = (id: ApiKey['id']) => revokeMyApiKeyFn({ data: { id } })
const rename = (id: ApiKey['id'], name: string) => renameMyApiKeyFn({ data: { id, name } })

/** /settings/api-keys: the signed-in teammate's own personal keys. */
export function PersonalApiKeys({ apiKeys, canCreate }: { apiKeys: ApiKey[]; canCreate: boolean }) {
  const intl = useIntl()
  const [createOpen, setCreateOpen] = useState(false)
  const [createOpened, setCreateOpened] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null)
  const [selected, setSelected] = useState<ApiKey | null>(null)
  const [dialog, setDialog] = useState<'rename' | 'rotate' | 'revoke' | null>(null)

  const reveal = (key: ApiKey, plainTextKey: string) => {
    setRevealed({ name: key.name, value: plainTextKey })
    setCreateOpen(false)
    setDialog(null)
    setRevealOpen(true)
  }

  const meta = (key: ApiKey) => {
    const expiry = key.expiresAt
      ? intl.formatMessage(m.expires, {
          date: <LocalDate date={key.expiresAt} options={EXPIRY_DATE} />,
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
        <span className="block whitespace-normal">{summarizeScopes(intl, key.scopes)}</span>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PortalPageHeader
        icon={KeyGlyph}
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
                leading={<RowIcon icon={KeyGlyph} />}
                title={key.name}
                meta={meta(key)}
                badges={
                  isKeyExpired(key) ? (
                    <Badge variant="secondary" size="sm">
                      {intl.formatMessage(m.expired)}
                    </Badge>
                  ) : undefined
                }
                actions={[
                  // An expired key no longer works: it can only be revoked.
                  ...(isKeyExpired(key)
                    ? []
                    : [
                        { label: intl.formatMessage(m.rename), dialog: 'rename' as const },
                        { label: intl.formatMessage(m.rotate), dialog: 'rotate' as const },
                      ]),
                  {
                    label: intl.formatMessage(m.revoke),
                    dialog: 'revoke' as const,
                    destructive: true,
                  },
                ].map(({ dialog: next, ...item }) => ({
                  ...item,
                  onSelect: () => {
                    setSelected(key)
                    setDialog(next)
                  },
                }))}
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

      {revealed && (
        <Suspense fallback={null}>
          <ApiKeyRevealDialog
            open={revealOpen}
            onOpenChange={setRevealOpen}
            keyValue={revealed.value}
            keyName={revealed.name}
            onClose={() => setRevealed(null)}
            messages={PORTAL_KEY_MESSAGES}
          />
        </Suspense>
      )}

      {selected && dialog && (
        <Suspense fallback={null}>
          {dialog === 'rename' && (
            <RenameApiKeyDialog
              open
              onOpenChange={(next) => setDialog(next ? 'rename' : null)}
              apiKey={selected}
              rename={rename}
              messages={PORTAL_KEY_MESSAGES}
            />
          )}
          {dialog === 'rotate' && (
            <RotateApiKeyDialog
              open
              onOpenChange={(next) => setDialog(next ? 'rotate' : null)}
              apiKey={selected}
              rotate={rotate}
              onKeyRotated={reveal}
              messages={PORTAL_KEY_MESSAGES}
            />
          )}
          {dialog === 'revoke' && (
            <RevokeApiKeyDialog
              open
              onOpenChange={(next) => setDialog(next ? 'revoke' : null)}
              apiKey={selected}
              revoke={revoke}
              messages={PORTAL_KEY_MESSAGES}
            />
          )}
        </Suspense>
      )}
    </div>
  )
}
