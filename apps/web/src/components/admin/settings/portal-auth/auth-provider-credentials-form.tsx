'use client'

import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  useSaveAuthProviderCredentials,
  useDeleteAuthProviderCredentials,
} from '@/lib/client/mutations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PlatformCredentialField } from '@/lib/shared/integration-types'

interface AuthProviderCredentialsFormProps {
  credentialType: string
  providerId: string
  providerName: string
  fields: PlatformCredentialField[]
  onSaved?: () => void
}

// Fields that only matter when Discovery URL is empty (manual endpoint
// override) or that have a sensible default (scopes). Collapsing these
// keeps Custom OIDC's default form to four fields instead of seven —
// most admins paste a discovery URL and never touch the manual paths.
const ADVANCED_FIELD_KEYS = new Set(['authorizationUrl', 'tokenUrl', 'scopes'])

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border/50 bg-muted/30 px-3 py-1.5 text-xs font-mono text-foreground select-all break-all">
          {value}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Copy to clipboard"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <ClipboardDocumentIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}

export function AuthProviderCredentialsForm({
  credentialType,
  providerId,
  providerName,
  fields,
  onSaved,
}: AuthProviderCredentialsFormProps) {
  const credentialsQuery = useSuspenseQuery(adminQueries.authProviderCredentials(credentialType))
  const isConfigured = credentialsQuery.data.configured
  const maskedFields = credentialsQuery.data.fields
  const baseUrl = credentialsQuery.data.baseUrl

  const [isEditing, setIsEditing] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})

  const saveMutation = useSaveAuthProviderCredentials()
  const deleteMutation = useDeleteAuthProviderCredentials()

  const redirectUri = `${baseUrl}/api/auth/callback/${providerId}`

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
      { credentialType, credentials: values },
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
      { credentialType },
      {
        onSuccess: () => {
          setValues({})
        },
      }
    )
  }

  // Required fields: clientId and clientSecret
  const requiredFilled = values['clientId']?.trim() && values['clientSecret']?.trim()

  // Partition fields into core vs Advanced and pre-compute whether the
  // disclosure should default to open. defaultOpen flips when the user
  // has typed into an advanced field (e.g. came back to edit after
  // partial entry) OR when no Discovery URL is configured — in which
  // case manual endpoints are required and shouldn't hide.
  const { coreFields, advancedFields, defaultOpen } = useMemo(() => {
    const core: PlatformCredentialField[] = []
    const advanced: PlatformCredentialField[] = []
    for (const f of fields) {
      if (ADVANCED_FIELD_KEYS.has(f.key)) advanced.push(f)
      else core.push(f)
    }
    const hasValue = advanced.some((f) => values[f.key]?.trim())
    const discoveryKey = fields.find((f) => f.key === 'discoveryUrl') ? 'discoveryUrl' : null
    const discoveryMissing =
      !!discoveryKey && !values[discoveryKey]?.trim() && !maskedFields?.[discoveryKey]
    return { coreFields: core, advancedFields: advanced, defaultOpen: hasValue || discoveryMissing }
  }, [fields, values, maskedFields])

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const shouldExpandAdvanced = advancedOpen || defaultOpen

  // Guidance section shown in both configured and editing states
  const guidanceSection = (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Use these values when creating your {providerName} OAuth app:
      </p>
      <CopyableField label="Redirect / Callback URI" value={redirectUri} />
      <CopyableField label="Homepage URL" value={baseUrl} />
    </div>
  )

  // Show masked values when configured and not editing
  if (isConfigured && !isEditing) {
    return (
      <div className="space-y-4">
        {guidanceSection}
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

  const renderField = (field: PlatformCredentialField) => (
    <div key={field.key}>
      <Label htmlFor={`auth-cred-${field.key}`} className="text-sm font-medium">
        {field.label}
      </Label>
      <Input
        id={`auth-cred-${field.key}`}
        type={field.sensitive ? 'password' : 'text'}
        placeholder={field.placeholder ?? ''}
        value={values[field.key] ?? ''}
        onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
        className="mt-1"
      />
      {field.helpText && <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p>}
    </div>
  )

  // Show input form when not configured or editing
  return (
    <div className="space-y-4">
      {guidanceSection}
      <div className="space-y-3">{coreFields.map(renderField)}</div>
      {advancedFields.length > 0 && (
        <details
          open={shouldExpandAdvanced}
          onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-md border border-border/40 bg-muted/10"
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            Advanced — manual endpoints &amp; scopes
          </summary>
          <div className="space-y-3 px-3 pt-1 pb-3">{advancedFields.map(renderField)}</div>
        </details>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={!requiredFilled || saveMutation.isPending}>
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
