'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InfoIcon } from 'lucide-react'

interface OAuthProviderTogglesProps {
  organizationId: string
  googleEnabled: boolean
  githubEnabled: boolean
  microsoftEnabled: boolean
  googleAvailable: boolean
  githubAvailable: boolean
  microsoftAvailable: boolean
}

export function OAuthProviderToggles({
  organizationId,
  googleEnabled: initialGoogleEnabled,
  githubEnabled: initialGithubEnabled,
  microsoftEnabled: initialMicrosoftEnabled,
  googleAvailable,
  githubAvailable,
  microsoftAvailable,
}: OAuthProviderTogglesProps) {
  const [googleEnabled, setGoogleEnabled] = useState(initialGoogleEnabled)
  const [githubEnabled, setGithubEnabled] = useState(initialGithubEnabled)
  const [microsoftEnabled, setMicrosoftEnabled] = useState(initialMicrosoftEnabled)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleToggle = (
    provider: 'google' | 'github' | 'microsoft',
    checked: boolean,
    setEnabled: (value: boolean) => void,
    apiField: string
  ) => {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/organization/security', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            [apiField]: checked,
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

  const noProvidersAvailable = !googleAvailable && !githubAvailable && !microsoftAvailable

  if (noProvidersAvailable) {
    return (
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          No OAuth providers are configured. Contact your system administrator to enable social
          login providers.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {googleAvailable && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="google-oauth" className="text-base font-medium">
              Google
            </Label>
            <p className="text-sm text-muted-foreground">Allow users to sign in with Google.</p>
          </div>
          <Switch
            id="google-oauth"
            checked={googleEnabled}
            onCheckedChange={(checked) =>
              handleToggle('google', checked, setGoogleEnabled, 'googleOAuthEnabled')
            }
            disabled={isPending}
          />
        </div>
      )}

      {microsoftAvailable && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="microsoft-oauth" className="text-base font-medium">
              Microsoft
            </Label>
            <p className="text-sm text-muted-foreground">
              Allow users to sign in with Microsoft accounts.
            </p>
          </div>
          <Switch
            id="microsoft-oauth"
            checked={microsoftEnabled}
            onCheckedChange={(checked) =>
              handleToggle('microsoft', checked, setMicrosoftEnabled, 'microsoftOAuthEnabled')
            }
            disabled={isPending}
          />
        </div>
      )}

      {githubAvailable && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="github-oauth" className="text-base font-medium">
              GitHub
            </Label>
            <p className="text-sm text-muted-foreground">Allow users to sign in with GitHub.</p>
          </div>
          <Switch
            id="github-oauth"
            checked={githubEnabled}
            onCheckedChange={(checked) =>
              handleToggle('github', checked, setGithubEnabled, 'githubOAuthEnabled')
            }
            disabled={isPending}
          />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
