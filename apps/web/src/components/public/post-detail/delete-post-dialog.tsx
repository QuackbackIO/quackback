'use client'

import { useState, useEffect } from 'react'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { getIntegrationActionVerb, getIntegrationDisplayName } from '@/lib/shared/integrations'

// ============================================================================
// Types
// ============================================================================

export interface ExternalLinkInfo {
  id: string
  integrationType: string
  externalId: string
  externalUrl: string | null
  integrationActive: boolean
  onDeleteDefault: 'archive' | 'nothing'
}

export interface CascadeChoice {
  linkId: string
  shouldArchive: boolean
}

// ============================================================================
// Helpers
// ============================================================================

/** Format an external ID for display (e.g., "LIN-423", "#142") */
function formatExternalId(integrationType: string, externalId: string): string {
  if (integrationType === 'github') return `#${externalId}`
  return externalId
}

// ============================================================================
// Component
// ============================================================================

interface DeletePostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  postTitle: string
  onConfirm: (cascadeChoices: CascadeChoice[]) => void
  isPending: boolean
  /** Override the default description text */
  description?: React.ReactNode
  /** External links for cascade delete checkboxes */
  externalLinks?: ExternalLinkInfo[]
  /** Whether external links are still loading */
  isLoadingLinks?: boolean
  /** Whether external links failed to load */
  isErrorLinks?: boolean
}

export function DeletePostDialog({
  open,
  onOpenChange,
  postTitle,
  onConfirm,
  isPending,
  description,
  externalLinks,
  isLoadingLinks,
  isErrorLinks,
}: DeletePostDialogProps) {
  const [choices, setChoices] = useState<Record<string, boolean>>({})

  // Reset choices when dialog opens with new links
  useEffect(() => {
    if (open && externalLinks) {
      const defaults: Record<string, boolean> = {}
      for (const link of externalLinks) {
        defaults[link.id] = link.integrationActive && link.onDeleteDefault === 'archive'
      }
      setChoices(defaults)
    }
  }, [open, externalLinks])

  const handleConfirm = () => {
    const cascadeChoices: CascadeChoice[] = (externalLinks ?? []).map((link) => ({
      linkId: link.id,
      shouldArchive: choices[link.id] ?? false,
    }))
    onConfirm(cascadeChoices)
  }

  const hasLinks = externalLinks && externalLinks.length > 0

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Post"
      description={
        description ?? (
          <>
            Are you sure you want to delete &ldquo;{postTitle}&rdquo;? This action cannot be undone.
          </>
        )
      }
      variant="destructive"
      confirmLabel={isPending ? 'Deleting...' : isLoadingLinks ? 'Loading...' : 'Delete'}
      isPending={isPending || isLoadingLinks || isErrorLinks}
      onConfirm={handleConfirm}
    >
      {isErrorLinks && (
        <p className="text-sm text-destructive">
          Failed to load linked integrations. Please close and try again.
        </p>
      )}
      {hasLinks && (
        <div className="rounded-lg border border-border/50 p-4 space-y-3">
          <p className="text-sm font-medium">Linked integrations</p>
          <div className="space-y-2">
            {externalLinks.map((link) => {
              const disabled = !link.integrationActive
              const checked = choices[link.id] ?? false
              const action = getIntegrationActionVerb(link.integrationType)
              const name = getIntegrationDisplayName(link.integrationType)
              const displayId = formatExternalId(link.integrationType, link.externalId)

              return (
                <div key={link.id} className="flex items-start gap-3">
                  <Checkbox
                    id={`cascade-${link.id}`}
                    checked={checked}
                    onCheckedChange={(val) =>
                      setChoices((prev) => ({ ...prev, [link.id]: val === true }))
                    }
                    disabled={disabled || isPending}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <Label
                      htmlFor={`cascade-${link.id}`}
                      className={`text-sm font-medium ${disabled ? 'text-muted-foreground' : ''}`}
                    >
                      {action} {displayId}
                      <span className="ml-1.5 text-muted-foreground font-normal">({name})</span>
                      {disabled && (
                        <span className="ml-1.5 text-muted-foreground font-normal">
                          (disconnected)
                        </span>
                      )}
                    </Label>
                    {link.externalUrl && (
                      <a
                        href={link.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
                      >
                        <span className="truncate">{link.externalUrl}</span>
                        <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </ConfirmDialog>
  )
}
