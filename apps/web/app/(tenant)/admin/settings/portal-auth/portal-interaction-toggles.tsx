'use client'

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface PortalInteractionTogglesProps {
  organizationId: string
  portalPublicVoting: boolean
  portalPublicCommenting: boolean
}

export function PortalInteractionToggles({
  organizationId,
  portalPublicVoting: initialPublicVoting,
  portalPublicCommenting: initialPublicCommenting,
}: PortalInteractionTogglesProps) {
  const [publicVoting, setPublicVoting] = useState(initialPublicVoting)
  const [publicCommenting, setPublicCommenting] = useState(initialPublicCommenting)
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="public-voting" className="text-base font-medium">
            Allow public voting
          </Label>
          <p className="text-sm text-muted-foreground">
            Let visitors upvote posts without signing in
          </p>
        </div>
        <Switch
          id="public-voting"
          checked={publicVoting}
          onCheckedChange={(checked) =>
            handleToggle('portalPublicVoting', checked, setPublicVoting)
          }
          disabled={isPending}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="public-commenting" className="text-base font-medium">
            Allow public comments
          </Label>
          <p className="text-sm text-muted-foreground">
            Let visitors add comments without signing in
          </p>
        </div>
        <Switch
          id="public-commenting"
          checked={publicCommenting}
          onCheckedChange={(checked) =>
            handleToggle('portalPublicCommenting', checked, setPublicCommenting)
          }
          disabled={isPending}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
