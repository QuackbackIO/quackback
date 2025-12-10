'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InfoIcon } from 'lucide-react'

interface PortalAuthTogglesProps {
  organizationId: string
  portalGoogleEnabled: boolean
  portalGithubEnabled: boolean
  googleAvailable: boolean
  githubAvailable: boolean
}

export function PortalAuthToggles({
  organizationId,
  portalGoogleEnabled: initialGoogleEnabled,
  portalGithubEnabled: initialGithubEnabled,
  googleAvailable,
  githubAvailable,
}: PortalAuthTogglesProps) {
  const [googleEnabled, setGoogleEnabled] = useState(initialGoogleEnabled)
  const [githubEnabled, setGithubEnabled] = useState(initialGithubEnabled)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleToggle = (field: string, checked: boolean, setEnabled: (value: boolean) => void) => {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/organization/portal-auth', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            [field]: checked,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update setting')
        }

        setEnabled(checked)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update setting')
        setEnabled(!checked)
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Auth methods */}
      <div className="space-y-4">
        <p className="text-sm font-medium text-muted-foreground">OAuth Providers</p>

        {googleAvailable && (
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="portal-google" className="text-base font-medium">
                Google
              </Label>
              <p className="text-sm text-muted-foreground">
                Allow portal users to sign in with Google
              </p>
            </div>
            <Switch
              id="portal-google"
              checked={googleEnabled}
              onCheckedChange={(checked) =>
                handleToggle('portalGoogleEnabled', checked, setGoogleEnabled)
              }
              disabled={isPending}
            />
          </div>
        )}

        {githubAvailable && (
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="portal-github" className="text-base font-medium">
                GitHub
              </Label>
              <p className="text-sm text-muted-foreground">
                Allow portal users to sign in with GitHub
              </p>
            </div>
            <Switch
              id="portal-github"
              checked={githubEnabled}
              onCheckedChange={(checked) =>
                handleToggle('portalGithubEnabled', checked, setGithubEnabled)
              }
              disabled={isPending}
            />
          </div>
        )}

        {!googleAvailable && !githubAvailable && (
          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertDescription>
              Social login providers are not configured. Contact your system administrator to enable
              Google or GitHub login.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
