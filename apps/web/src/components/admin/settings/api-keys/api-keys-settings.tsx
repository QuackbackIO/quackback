'use client'

import { useState } from 'react'
import { KeyIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { CreateApiKeyDialog } from './create-api-key-dialog'
import { ApiKeyRevealDialog } from './api-key-reveal-dialog'
import { RevokeApiKeyDialog } from './revoke-api-key-dialog'
import { RotateApiKeyDialog } from './rotate-api-key-dialog'
import type { ApiKey } from '@/lib/shared/types'
import { summarizeDomainAccess } from '@/lib/server/domains/api-keys/api-key-scopes'
import { formatDistanceToNow } from 'date-fns'

interface ApiKeysSettingsProps {
  apiKeys: ApiKey[]
}

export function ApiKeysSettings({ apiKeys }: ApiKeysSettingsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [revealDialogOpen, setRevealDialogOpen] = useState(false)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null)
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null)

  const handleKeyCreated = (key: ApiKey, plainTextKey: string) => {
    setNewKeyValue(plainTextKey)
    setSelectedKey(key)
    setCreateDialogOpen(false)
    setRevealDialogOpen(true)
  }

  const handleKeyRotated = (key: ApiKey, plainTextKey: string) => {
    setNewKeyValue(plainTextKey)
    setSelectedKey(key)
    setRotateDialogOpen(false)
    setRevealDialogOpen(true)
  }

  const handleRevokeClick = (key: ApiKey) => {
    setSelectedKey(key)
    setRevokeDialogOpen(true)
  }

  const handleRotateClick = (key: ApiKey) => {
    setSelectedKey(key)
    setRotateDialogOpen(true)
  }

  const newKeyButton = <NewButton noun="API key" onClick={() => setCreateDialogOpen(true)} />

  return (
    <>
      <SettingsCard
        title="API keys"
        description="Shown only once, when created."
        action={newKeyButton}
        flush
      >
        {apiKeys.length === 0 ? (
          <EmptyState
            size="compact"
            icon={KeyIcon}
            title="No API keys yet"
            description="Keys let your apps read and write feedback through the REST API."
            action={newKeyButton}
          />
        ) : (
          <SettingsList>
            {apiKeys.map((key) => (
              <SettingsListRow
                key={key.id}
                leading={<RowIcon icon={KeyIcon} />}
                title={key.name}
                meta={
                  <>
                    <code className="font-mono text-xs">{key.keyPrefix}...</code>
                    {' · '}
                    Created {formatDistanceToNow(key.createdAt, { addSuffix: true })}
                    {' · '}
                    {key.lastUsedAt
                      ? `Last used ${formatDistanceToNow(key.lastUsedAt, { addSuffix: true })}`
                      : 'Never used'}
                    <span className="block whitespace-normal">
                      {summarizeDomainAccess(key.scopes)}
                    </span>
                  </>
                }
                actions={[
                  { label: 'Rotate', onSelect: () => handleRotateClick(key) },
                  { label: 'Revoke', destructive: true, onSelect: () => handleRevokeClick(key) },
                ]}
              />
            ))}
          </SettingsList>
        )}
      </SettingsCard>

      {/* Dialogs */}
      <CreateApiKeyDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onKeyCreated={handleKeyCreated}
      />

      <ApiKeyRevealDialog
        open={revealDialogOpen}
        onOpenChange={setRevealDialogOpen}
        keyValue={newKeyValue}
        keyName={selectedKey?.name ?? ''}
        onClose={() => setNewKeyValue(null)}
      />

      {selectedKey && (
        <>
          <RevokeApiKeyDialog
            open={revokeDialogOpen}
            onOpenChange={setRevokeDialogOpen}
            apiKey={selectedKey}
          />

          <RotateApiKeyDialog
            open={rotateDialogOpen}
            onOpenChange={setRotateDialogOpen}
            apiKey={selectedKey}
            onKeyRotated={handleKeyRotated}
          />
        </>
      )}
    </>
  )
}
