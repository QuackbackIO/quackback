'use client'

import { lazy, Suspense, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { defineMessages, useIntl } from 'react-intl'
import { KeyIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowActions } from '@/components/admin/settings/settings-list'
import { KeyTable, KeyTableCell, KeyTableHead } from './key-table'
import { formatDistanceToNow } from 'date-fns'
import { revokeApiKeyFn, rotateApiKeyFn, updateApiKeyFn } from '@/lib/server/functions/api-keys'
import type { ManagedApiKey } from '@/lib/server/domains/api-keys/api-key.types'
import type { ApiKey } from '@/lib/shared/types'
import { summarizeDomainAccess } from '@/lib/shared/api-key-scopes'
import { creatorLabel, ExpiredTag, isKeyExpired, SHORT_DATE } from './key-labels'

// Each dialog loads when first opened.
const ApiKeyRevealDialog = lazy(() =>
  import('./key-dialogs').then((mod) => ({ default: mod.ApiKeyRevealDialog }))
)
const RevokeApiKeyDialog = lazy(() =>
  import('./key-dialogs').then((mod) => ({ default: mod.RevokeApiKeyDialog }))
)
const RotateApiKeyDialog = lazy(() =>
  import('./key-dialogs').then((mod) => ({ default: mod.RotateApiKeyDialog }))
)
const RenameApiKeyDialog = lazy(() =>
  import('./key-dialogs').then((mod) => ({ default: mod.RenameApiKeyDialog }))
)
const ChangeKeyRoleDialog = lazy(() =>
  import('./change-key-role-dialog').then((mod) => ({ default: mod.ChangeKeyRoleDialog }))
)

const m = defineMessages({
  title: { id: 'apiKeys.workspace.title', defaultMessage: 'Workspace keys' },
  description: {
    id: 'apiKeys.workspace.description',
    defaultMessage:
      'For integrations. Each key has its own role and keeps working when people leave.',
  },
  newKey: { id: 'apiKeys.workspace.new', defaultMessage: 'New workspace key' },
  emptyTitle: { id: 'apiKeys.workspace.emptyTitle', defaultMessage: 'No workspace keys yet' },
  emptyDescription: {
    id: 'apiKeys.workspace.emptyDescription',
    defaultMessage: 'Use one for an integration that should keep working when people leave.',
  },
  name: { id: 'apiKeys.column.name', defaultMessage: 'Name' },
  role: { id: 'apiKeys.column.role', defaultMessage: 'Role' },
  scopes: { id: 'apiKeys.column.scopes', defaultMessage: 'Scopes' },
  settingsRead: { id: 'apiKeys.scopes.settingsReadSummary', defaultMessage: 'Settings (read)' },
  settingsReadWrite: {
    id: 'apiKeys.scopes.settingsReadWriteSummary',
    defaultMessage: 'Settings (read and write)',
  },
  createdBy: { id: 'apiKeys.column.createdBy', defaultMessage: 'Created by' },
  lastUsed: { id: 'apiKeys.column.lastUsed', defaultMessage: 'Last used' },
  actions: { id: 'apiKeys.column.actions', defaultMessage: 'Actions' },
  never: { id: 'apiKeys.never', defaultMessage: 'Never' },
  createdOn: { id: 'apiKeys.workspace.createdByOn', defaultMessage: '{creator}, {date}' },
  rename: { id: 'apiKeys.action.rename', defaultMessage: 'Rename' },
  changeRole: { id: 'apiKeys.action.changeRole', defaultMessage: 'Change role' },
  rotate: { id: 'apiKeys.action.rotate', defaultMessage: 'Rotate' },
  revoke: { id: 'apiKeys.action.revoke', defaultMessage: 'Revoke' },
  expired: { id: 'apiKeys.expired', defaultMessage: 'Expired' },
})

type Dialog = 'rename' | 'role' | 'rotate' | 'revoke'

const rotate = (id: ApiKey['id']) => rotateApiKeyFn({ data: { id } })
const revoke = (id: ApiKey['id']) => revokeApiKeyFn({ data: { id } })
const rename = (id: ApiKey['id'], name: string) => updateApiKeyFn({ data: { id, name } })

/** Settings > Developers: keys for integrations, each holding its own role. */
export function WorkspaceKeysSettings({ apiKeys }: { apiKeys: ManagedApiKey[] }) {
  const intl = useIntl()
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null)
  const [selected, setSelected] = useState<ManagedApiKey | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const reveal = (key: ApiKey, plainTextKey: string) => {
    setRevealed({ name: key.name, value: plainTextKey })
    setDialog(null)
    setRevealOpen(true)
  }

  const open = (key: ManagedApiKey, next: Dialog) => {
    setSelected(key)
    setDialog(next)
  }
  // Rename, change role and rotate only for a live key whose role the viewer
  // could grant; any key manager can revoke any key.
  const rowActions = (key: ManagedApiKey) => [
    ...(key.manageable && !isKeyExpired(key)
      ? [
          { label: intl.formatMessage(m.rename), onSelect: () => open(key, 'rename') },
          { label: intl.formatMessage(m.changeRole), onSelect: () => open(key, 'role') },
          { label: intl.formatMessage(m.rotate), onSelect: () => open(key, 'rotate') },
        ]
      : []),
    {
      label: intl.formatMessage(m.revoke),
      destructive: true,
      onSelect: () => open(key, 'revoke'),
    },
  ]
  const dialogOpen = (which: Dialog) => dialog === which
  const setDialogOpen = (which: Dialog) => (next: boolean) => setDialog(next ? which : null)

  const newKeyButton = (
    <NewButton noun="workspace key" asChild>
      <Link to="/admin/settings/developers/workspace-keys/new">{intl.formatMessage(m.newKey)}</Link>
    </NewButton>
  )

  return (
    <>
      <SettingsCard
        title={intl.formatMessage(m.title)}
        description={intl.formatMessage(m.description)}
        action={newKeyButton}
        flush
      >
        {apiKeys.length === 0 ? (
          <EmptyState
            size="compact"
            icon={KeyIcon}
            title={intl.formatMessage(m.emptyTitle)}
            description={intl.formatMessage(m.emptyDescription)}
            action={newKeyButton}
          />
        ) : (
          <KeyTable>
            <thead>
              <tr>
                <KeyTableHead className="pl-4 sm:pl-6">{intl.formatMessage(m.name)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.role)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.scopes)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.createdBy)}</KeyTableHead>
                <KeyTableHead>{intl.formatMessage(m.lastUsed)}</KeyTableHead>
                <KeyTableHead className="w-10 pr-4 sm:pr-6">
                  <span className="sr-only">{intl.formatMessage(m.actions)}</span>
                </KeyTableHead>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((key) => (
                <tr key={key.id} className="group">
                  <KeyTableCell className="pl-4 sm:pl-6">
                    <div className="flex items-center gap-2 font-medium">
                      {key.name}
                      {isKeyExpired(key) && <ExpiredTag label={intl.formatMessage(m.expired)} />}
                    </div>
                    <code className="font-mono text-xs text-muted-foreground">
                      {key.keyPrefix}...
                    </code>
                  </KeyTableCell>
                  <KeyTableCell>{key.role?.name ?? ''}</KeyTableCell>
                  <KeyTableCell className="whitespace-normal text-muted-foreground">
                    {summarizeDomainAccess(key.scopes, (level) =>
                      intl.formatMessage(level === 'read' ? m.settingsRead : m.settingsReadWrite)
                    )}
                  </KeyTableCell>
                  <KeyTableCell className="text-muted-foreground">
                    {intl.formatMessage(m.createdOn, {
                      creator: creatorLabel(intl, key),
                      date: intl.formatDate(key.createdAt, SHORT_DATE),
                    })}
                  </KeyTableCell>
                  <KeyTableCell className="text-muted-foreground">
                    {key.lastUsedAt
                      ? formatDistanceToNow(key.lastUsedAt, { addSuffix: true })
                      : intl.formatMessage(m.never)}
                  </KeyTableCell>
                  <KeyTableCell className="pr-4 text-right sm:pr-6">
                    <RowActions label={key.name} items={rowActions(key)} />
                  </KeyTableCell>
                </tr>
              ))}
            </tbody>
          </KeyTable>
        )}
      </SettingsCard>

      {revealed && (
        <Suspense fallback={null}>
          <ApiKeyRevealDialog
            open={revealOpen}
            onOpenChange={setRevealOpen}
            keyValue={revealed.value}
            keyName={revealed.name}
            onClose={() => setRevealed(null)}
          />
        </Suspense>
      )}

      {selected && dialog && (
        <Suspense fallback={null}>
          {dialogOpen('rename') && (
            <RenameApiKeyDialog
              open
              onOpenChange={setDialogOpen('rename')}
              apiKey={selected}
              rename={rename}
            />
          )}
          {dialogOpen('role') && (
            <ChangeKeyRoleDialog open onOpenChange={setDialogOpen('role')} apiKey={selected} />
          )}
          {dialogOpen('rotate') && (
            <RotateApiKeyDialog
              open
              onOpenChange={setDialogOpen('rotate')}
              apiKey={selected}
              rotate={rotate}
              onKeyRotated={reveal}
            />
          )}
          {dialogOpen('revoke') && (
            <RevokeApiKeyDialog
              open
              onOpenChange={setDialogOpen('revoke')}
              apiKey={selected}
              revoke={revoke}
            />
          )}
        </Suspense>
      )}
    </>
  )
}
