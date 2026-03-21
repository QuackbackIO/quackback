'use client'

import { useState, useEffect } from 'react'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { INTEGRATION_ICON_MAP } from '@/components/icons/integration-icons'
import {
  getIntegrationActionVerb,
  getIntegrationDisplayName,
  getIntegrationItemNoun,
} from '@/lib/shared/integrations'

// ============================================================================
// Types
// ============================================================================

export interface ExternalLinkInfo {
  id: string
  integrationType: string
  externalId: string
  externalDisplayId: string | null
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

/** Format an external ID for display (e.g., "#142") */
function formatExternalId(integrationType: string, externalId: string): string {
  if (integrationType === 'github') return `#${externalId}`
  return externalId
}

/** Get the best display ID available */
function getDisplayId(link: ExternalLinkInfo): string {
  if (link.externalDisplayId) return formatExternalId(link.integrationType, link.externalDisplayId)
  return formatExternalId(link.integrationType, link.externalId)
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
      confirmLabel={isPending ? 'Deleting...' : isLoadingLinks ? 'Loading...' : 'Delete Post'}
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
          {externalLinks.map((link) => {
            const disabled = !link.integrationActive
            const checked = choices[link.id] ?? false
            const verb = getIntegrationActionVerb(link.integrationType)
            const name = getIntegrationDisplayName(link.integrationType)
            const noun = getIntegrationItemNoun(link.integrationType)
            const displayId = getDisplayId(link)
            const Icon = INTEGRATION_ICON_MAP[link.integrationType]
            const pastTense = verb === 'Close' ? 'closed' : 'archived'

            return (
              <div key={link.id} className="flex items-start gap-3">
                <Checkbox
                  id={`cascade-${link.id}`}
                  checked={checked}
                  onCheckedChange={(val) =>
                    setChoices((prev) => ({ ...prev, [link.id]: val === true }))
                  }
                  disabled={disabled || isPending}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <Label
                    htmlFor={`cascade-${link.id}`}
                    className={`flex items-center gap-2 text-sm font-medium ${disabled ? 'text-muted-foreground' : ''}`}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}
                    <span>
                      {disabled
                        ? `${name} ${noun} (disconnected)`
                        : `${verb} linked ${name} ${noun}`}
                    </span>
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5 ml-6">
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{displayId}</code>
                    {disabled
                      ? ` — integration disconnected, cannot ${verb.toLowerCase()}`
                      : ` will be ${pastTense} in ${name}.`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ConfirmDialog>
  )
}
