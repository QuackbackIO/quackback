'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

interface StrictSsoToggleProps {
  organizationId: string
  initialValue: boolean
}

export function StrictSsoToggle({ organizationId, initialValue }: StrictSsoToggleProps) {
  const [enabled, setEnabled] = useState(initialValue)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleToggle = (checked: boolean) => {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/organization/security', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            strictSsoMode: checked,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update setting')
        }

        setEnabled(checked)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update setting')
        // Revert the toggle on error
        setEnabled(!checked)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="strict-sso" className="text-base font-medium">
            Strict SSO Mode
          </Label>
          <p className="text-sm text-muted-foreground">
            When enabled, users signing in via SSO will get isolated accounts that cannot be linked
            to existing accounts with the same email address.
          </p>
        </div>
        <Switch
          id="strict-sso"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
        />
      </div>

      {enabled && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Fork, Don&apos;t Merge:</strong> SSO users will have isolated identities within
            this organization. Their email will be salted to prevent account linking, and their real
            email will be stored in metadata for display and notifications.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
