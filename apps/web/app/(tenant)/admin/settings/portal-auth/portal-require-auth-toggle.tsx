'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InfoIcon } from 'lucide-react'

interface PortalRequireAuthToggleProps {
  organizationId: string
  initialValue: boolean
}

export function PortalRequireAuthToggle({
  organizationId,
  initialValue,
}: PortalRequireAuthToggleProps) {
  const [requireAuth, setRequireAuth] = useState(initialValue)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleToggle = (checked: boolean) => {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/organization/portal-auth', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            portalRequireAuth: checked,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update setting')
        }

        setRequireAuth(checked)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update setting')
        setRequireAuth(!checked)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="portal-require-auth" className="text-base font-medium">
            Require Authentication for Interactions
          </Label>
          <p className="text-sm text-muted-foreground">
            When enabled, visitors must sign in to vote or comment. Anonymous interactions will be
            disabled.
          </p>
        </div>
        <Switch
          id="portal-require-auth"
          checked={requireAuth}
          onCheckedChange={handleToggle}
          disabled={isPending}
        />
      </div>

      {requireAuth && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            Anonymous voting and commenting is disabled. Visitors must create an account or sign in
            to interact with posts.
          </AlertDescription>
        </Alert>
      )}

      {!requireAuth && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            Anonymous interactions are allowed. Visitors can vote and comment without signing in.
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
