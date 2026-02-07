'use client'

import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { useSavePlatformCredentials, useDeletePlatformCredentials } from '@/lib/client/mutations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PlatformCredentialField } from '@/lib/server/integrations/types'

interface PlatformCredentialsFormProps {
  integrationType: string
  fields: PlatformCredentialField[]
  onSaved?: () => void
}

export function PlatformCredentialsForm({
  integrationType,
  fields,
  onSaved,
}: PlatformCredentialsFormProps) {
  const credentialsQuery = useSuspenseQuery(adminQueries.platformCredentials(integrationType))
  const isConfigured = credentialsQuery.data.configured
  const maskedFields = credentialsQuery.data.fields

  const [isEditing, setIsEditing] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})

  const saveMutation = useSavePlatformCredentials()
  const deleteMutation = useDeletePlatformCredentials()

  const handleStartEdit = () => {
    setValues({})
    setIsEditing(true)
  }

  const handleCancel = () => {
    setValues({})
    setIsEditing(false)
  }

  const handleSave = () => {
    saveMutation.mutate(
      { integrationType, credentials: values },
      {
        onSuccess: () => {
          setIsEditing(false)
          setValues({})
          onSaved?.()
        },
      }
    )
  }

  const handleDelete = () => {
    deleteMutation.mutate(
      { integrationType },
      {
        onSuccess: () => {
          setValues({})
        },
      }
    )
  }

  const allFieldsFilled = fields.every((f) => values[f.key]?.trim())

  // Show masked values when configured and not editing
  if (isConfigured && !isEditing) {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.key}>
              <Label className="text-sm font-medium text-muted-foreground">{field.label}</Label>
              <div className="mt-1 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm font-mono text-muted-foreground">
                {maskedFields?.[field.key] ?? '—'}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleStartEdit}>
            Update
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="text-destructive hover:text-destructive"
          >
            {deleteMutation.isPending ? 'Removing...' : 'Remove'}
          </Button>
        </div>
      </div>
    )
  }

  // Show input form when not configured or editing
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.key}>
            <Label htmlFor={`cred-${field.key}`} className="text-sm font-medium">
              {field.label}
            </Label>
            <Input
              id={`cred-${field.key}`}
              type={field.sensitive ? 'password' : 'text'}
              placeholder={field.placeholder ?? ''}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className="mt-1"
            />
            {field.helpText && (
              <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p>
            )}
            {field.helpUrl && (
              <a
                href={field.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-primary hover:underline"
              >
                Get credentials from provider
              </a>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!allFieldsFilled || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
        {isEditing && (
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>
      {saveMutation.isError && (
        <p className="text-sm text-destructive">
          {saveMutation.error?.message ?? 'Failed to save credentials'}
        </p>
      )}
    </div>
  )
}
