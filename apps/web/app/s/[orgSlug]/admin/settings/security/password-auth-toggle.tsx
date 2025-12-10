'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

interface PasswordAuthToggleProps {
  organizationId: string
  initialValue: boolean
}

export function PasswordAuthToggle({ organizationId, initialValue }: PasswordAuthToggleProps) {
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
            passwordAuthEnabled: checked,
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
      <div className="flex items-center gap-3">
        <Switch
          id="password-auth"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
        />
        <Label htmlFor="password-auth" className="text-sm">
          {enabled ? 'Enabled' : 'Disabled'}
        </Label>
      </div>

      {!enabled && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Password authentication is disabled. Users must sign in using OAuth or SSO.
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
