'use client'

import { useState } from 'react'
import { PlusIcon, ArrowPathIcon, TrashIcon, KeyIcon } from '@heroicons/react/24/outline'
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateApiKeyDialog } from './create-api-key-dialog'
import { ApiKeyRevealDialog } from './api-key-reveal-dialog'
import { RevokeApiKeyDialog } from './revoke-api-key-dialog'
import { RotateApiKeyDialog } from './rotate-api-key-dialog'
import type { ApiKey } from '@/lib/server/domains/api-keys'
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

  return (
    <div className="space-y-4">
      {/* Empty state */}
      {apiKeys.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-lg border border-dashed">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
            <KeyIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium mb-1">No API keys yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            API keys let you integrate Quackback with your apps, sync feedback programmatically, and
            build custom workflows.
          </p>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            Create your first API key
          </Button>
        </div>
      )}

      {/* Header with create button */}
      {apiKeys.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {apiKeys.length} active {apiKeys.length === 1 ? 'key' : 'keys'}
          </p>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            Create Key
          </Button>
        </div>
      )}

      {/* API Keys list */}
      {apiKeys.length > 0 && (
        <div className="space-y-3">
          {apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border/50 p-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <KeyIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{key.name}</p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono w-fit">
                      {key.keyPrefix}...
                    </code>
                    <span className="hidden sm:inline">·</span>
                    <span>Created {formatDistanceToNow(key.createdAt, { addSuffix: true })}</span>
                    {key.lastUsedAt ? (
                      <>
                        <span className="hidden sm:inline">·</span>
                        <span>
                          Last used {formatDistanceToNow(key.lastUsedAt, { addSuffix: true })}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="hidden sm:inline">·</span>
                        <span className="text-amber-600 dark:text-amber-400">Never used</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Desktop: show buttons */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRotateClick(key)}
                  aria-label={`Rotate ${key.name} API key`}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRevokeClick(key)}
                  aria-label={`Revoke ${key.name} API key`}
                  className="text-destructive hover:text-destructive"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>

              {/* Mobile: dropdown menu */}
              <div className="sm:hidden self-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" aria-label="Key actions">
                      <EllipsisVerticalIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleRotateClick(key)}>
                      <ArrowPathIcon className="h-4 w-4 mr-2" />
                      Rotate Key
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleRevokeClick(key)}
                      className="text-destructive focus:text-destructive"
                    >
                      <TrashIcon className="h-4 w-4 mr-2" />
                      Revoke Key
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

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
    </div>
  )
}
