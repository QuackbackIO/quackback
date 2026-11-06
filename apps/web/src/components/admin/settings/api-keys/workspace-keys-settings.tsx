'use client'

import { lazy, Suspense, useState } from 'react'
import { defineMessages, useIntl } from 'react-intl'
import { KeyIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowActions } from '@/components/admin/settings/settings-list'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TimeAgo } from '@/components/ui/time-ago'
import { revokeApiKeyFn, rotateApiKeyFn, updateApiKeyFn } from '@/lib/server/functions/api-keys'
import type { ManagedApiKey } from '@/lib/server/domains/api-keys/api-key.types'
import type { ApiKey } from '@/lib/shared/types'
import { ApiKeyRevealDialog } from './api-key-reveal-dialog'
import { RevokeApiKeyDialog } from './revoke-api-key-dialog'
import { RotateApiKeyDialog } from './rotate-api-key-dialog'
import { RenameApiKeyDialog } from './rename-api-key-dialog'
import { creatorLabel, shortDate } from './key-labels'

// The dialogs with the role list load when first opened.
const CreateWorkspaceKeyDialog = lazy(() =>
  import('./create-workspace-key-dialog').then((mod) => ({
    default: mod.CreateWorkspaceKeyDialog,
  }))
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
  createdBy: { id: 'apiKeys.column.createdBy', defaultMessage: 'Created by' },
  lastUsed: { id: 'apiKeys.column.lastUsed', defaultMessage: 'Last used' },
  actions: { id: 'apiKeys.column.actions', defaultMessage: 'Actions' },
  never: { id: 'apiKeys.never', defaultMessage: 'Never' },
  createdOn: { id: 'apiKeys.workspace.createdByOn', defaultMessage: '{creator}, {date}' },
  rename: { id: 'apiKeys.action.rename', defaultMessage: 'Rename' },
  changeRole: { id: 'apiKeys.action.changeRole', defaultMessage: 'Change role' },
  rotate: { id: 'apiKeys.action.rotate', defaultMessage: 'Rotate' },
  revoke: { id: 'apiKeys.action.revoke', defaultMessage: 'Revoke' },
})

type Dialog = 'rename' | 'role' | 'rotate' | 'revoke'

const rotate = (id: ApiKey['id']) => rotateApiKeyFn({ data: { id } })
const revoke = (id: ApiKey['id']) => revokeApiKeyFn({ data: { id } })
const rename = (id: ApiKey['id'], name: string) => updateApiKeyFn({ data: { id, name } })

/** Settings > Developers: keys for integrations, each holding its own role. */
export function WorkspaceKeysSettings({ apiKeys }: { apiKeys: ManagedApiKey[] }) {
  const intl = useIntl()
  const [createOpen, setCreateOpen] = useState(false)
  const [createOpened, setCreateOpened] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null)
  const [selected, setSelected] = useState<ManagedApiKey | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const reveal = (key: ApiKey, plainTextKey: string) => {
    setRevealed({ name: key.name, value: plainTextKey })
    setCreateOpen(false)
    setDialog(null)
    setRevealOpen(true)
  }

  const open = (key: ManagedApiKey, next: Dialog) => {
    setSelected(key)
    setDialog(next)
  }
  const dialogOpen = (which: Dialog) => dialog === which
  const setDialogOpen = (which: Dialog) => (next: boolean) => setDialog(next ? which : null)

  const newKeyButton = (
    <NewButton
      noun="workspace key"
      onClick={() => {
        setCreateOpened(true)
        setCreateOpen(true)
      }}
    >
      {intl.formatMessage(m.newKey)}
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
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 sm:pl-6">{intl.formatMessage(m.name)}</TableHead>
                <TableHead>{intl.formatMessage(m.role)}</TableHead>
                <TableHead>{intl.formatMessage(m.createdBy)}</TableHead>
                <TableHead>{intl.formatMessage(m.lastUsed)}</TableHead>
                <TableHead className="w-10 pr-4 sm:pr-6">
                  <span className="sr-only">{intl.formatMessage(m.actions)}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((key) => (
                <TableRow key={key.id} className="group hover:bg-transparent">
                  <TableCell className="pl-4 sm:pl-6">
                    <div className="font-medium">{key.name}</div>
                    <code className="font-mono text-xs text-muted-foreground">
                      {key.keyPrefix}...
                    </code>
                  </TableCell>
                  <TableCell>{key.role?.name ?? ''}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {intl.formatMessage(m.createdOn, {
                      creator: creatorLabel(intl, key),
                      date: shortDate(key.createdAt),
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {key.lastUsedAt ? (
                      <TimeAgo date={key.lastUsedAt} />
                    ) : (
                      intl.formatMessage(m.never)
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right sm:pr-6">
                    <RowActions
                      label={key.name}
                      items={[
                        {
                          label: intl.formatMessage(m.rename),
                          onSelect: () => open(key, 'rename'),
                        },
                        {
                          label: intl.formatMessage(m.changeRole),
                          onSelect: () => open(key, 'role'),
                        },
                        {
                          label: intl.formatMessage(m.rotate),
                          onSelect: () => open(key, 'rotate'),
                        },
                        {
                          label: intl.formatMessage(m.revoke),
                          destructive: true,
                          onSelect: () => open(key, 'revoke'),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>

      {createOpened && (
        <Suspense fallback={null}>
          <CreateWorkspaceKeyDialog
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
          {dialogOpen('rename') && (
            <RenameApiKeyDialog
              open
              onOpenChange={setDialogOpen('rename')}
              apiKey={selected}
              rename={rename}
            />
          )}
          {dialogOpen('role') && (
            <Suspense fallback={null}>
              <ChangeKeyRoleDialog open onOpenChange={setDialogOpen('role')} apiKey={selected} />
            </Suspense>
          )}
          <RotateApiKeyDialog
            open={dialogOpen('rotate')}
            onOpenChange={setDialogOpen('rotate')}
            apiKey={selected}
            rotate={rotate}
            onKeyRotated={reveal}
          />
          <RevokeApiKeyDialog
            open={dialogOpen('revoke')}
            onOpenChange={setDialogOpen('revoke')}
            apiKey={selected}
            revoke={revoke}
          />
        </>
      )}
    </>
  )
}
