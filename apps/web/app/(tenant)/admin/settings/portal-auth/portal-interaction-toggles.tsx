'use client'

import { useState, useTransition } from 'react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { PermissionLevel } from '@quackback/db/types'

interface PortalInteractionTogglesProps {
  organizationId: string
  portalVoting: PermissionLevel
  portalCommenting: PermissionLevel
  portalSubmissions: PermissionLevel
}

const permissionOptions = [
  { value: 'anyone', label: 'Anyone', description: 'Including anonymous visitors' },
  { value: 'authenticated', label: 'Signed-in users', description: 'Requires authentication' },
  { value: 'disabled', label: 'Disabled', description: 'Not allowed on the portal' },
] as const

export function PortalInteractionToggles({
  organizationId,
  portalVoting: initialVoting,
  portalCommenting: initialCommenting,
  portalSubmissions: initialSubmissions,
}: PortalInteractionTogglesProps) {
  const [voting, setVoting] = useState<PermissionLevel>(initialVoting)
  const [commenting, setCommenting] = useState<PermissionLevel>(initialCommenting)
  const [submissions, setSubmissions] = useState<PermissionLevel>(initialSubmissions)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleChange = (
    field: 'portalVoting' | 'portalCommenting' | 'portalSubmissions',
    value: PermissionLevel,
    setter: (value: PermissionLevel) => void,
    previousValue: PermissionLevel
  ) => {
    setError(null)
    setter(value) // Optimistic update
    startTransition(async () => {
      try {
        const response = await fetch('/api/organization/portal-auth', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            [field]: value,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update setting')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update setting')
        setter(previousValue) // Revert on error
      }
    })
  }

  return (
    <div className="space-y-8">
      {/* Voting */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Voting</Label>
          <p className="text-sm text-muted-foreground">
            Who can upvote posts on your public portal
          </p>
        </div>
        <RadioGroup
          value={voting}
          onValueChange={(value) =>
            handleChange('portalVoting', value as PermissionLevel, setVoting, voting)
          }
          disabled={isPending}
          className="grid gap-2"
        >
          {permissionOptions.map((option) => (
            <div
              key={option.value}
              className="flex items-center space-x-3 rounded-lg border border-border/50 p-3 hover:bg-muted/50"
            >
              <RadioGroupItem value={option.value} id={`voting-${option.value}`} />
              <Label
                htmlFor={`voting-${option.value}`}
                className="flex-1 cursor-pointer font-normal"
              >
                <span className="font-medium">{option.label}</span>
                <span className="ml-2 text-muted-foreground">{option.description}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {/* Commenting */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Commenting</Label>
          <p className="text-sm text-muted-foreground">Who can leave comments on posts</p>
        </div>
        <RadioGroup
          value={commenting}
          onValueChange={(value) =>
            handleChange('portalCommenting', value as PermissionLevel, setCommenting, commenting)
          }
          disabled={isPending}
          className="grid gap-2"
        >
          {permissionOptions.map((option) => (
            <div
              key={option.value}
              className="flex items-center space-x-3 rounded-lg border border-border/50 p-3 hover:bg-muted/50"
            >
              <RadioGroupItem value={option.value} id={`commenting-${option.value}`} />
              <Label
                htmlFor={`commenting-${option.value}`}
                className="flex-1 cursor-pointer font-normal"
              >
                <span className="font-medium">{option.label}</span>
                <span className="ml-2 text-muted-foreground">{option.description}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {/* Submissions */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Submissions</Label>
          <p className="text-sm text-muted-foreground">Who can submit new feedback posts</p>
        </div>
        <RadioGroup
          value={submissions}
          onValueChange={(value) =>
            handleChange('portalSubmissions', value as PermissionLevel, setSubmissions, submissions)
          }
          disabled={isPending}
          className="grid gap-2"
        >
          {permissionOptions.map((option) => (
            <div
              key={option.value}
              className="flex items-center space-x-3 rounded-lg border border-border/50 p-3 hover:bg-muted/50"
            >
              <RadioGroupItem value={option.value} id={`submissions-${option.value}`} />
              <Label
                htmlFor={`submissions-${option.value}`}
                className="flex-1 cursor-pointer font-normal"
              >
                <span className="font-medium">{option.label}</span>
                <span className="ml-2 text-muted-foreground">{option.description}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
