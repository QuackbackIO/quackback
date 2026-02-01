import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowPathIcon, EnvelopeIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'
import { GitHubIcon, GoogleIcon } from '@/components/icons/social-icons'

interface PortalAuthSettingsProps {
  initialConfig: {
    oauth: { email?: boolean; google: boolean; github: boolean }
  }
}

export function PortalAuthSettings({ initialConfig }: PortalAuthSettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(initialConfig.oauth.email ?? true)
  const [githubEnabled, setGithubEnabled] = useState(initialConfig.oauth.github)
  const [googleEnabled, setGoogleEnabled] = useState(initialConfig.oauth.google)

  // Count enabled auth methods to prevent disabling the last one
  const enabledMethodCount = [emailEnabled, githubEnabled, googleEnabled].filter(Boolean).length
  const isLastEnabledMethod = (method: boolean) => method && enabledMethodCount === 1

  const saveOAuthConfig = async (oauth: {
    email?: boolean
    google?: boolean
    github?: boolean
  }) => {
    setSaving(true)
    try {
      await updatePortalConfigFn({ data: { oauth } })
      startTransition(() => {
        router.invalidate()
      })
    } finally {
      setSaving(false)
    }
  }

  const handleEmailChange = (checked: boolean) => {
    setEmailEnabled(checked)
    saveOAuthConfig({ email: checked })
  }

  const handleGithubChange = (checked: boolean) => {
    setGithubEnabled(checked)
    saveOAuthConfig({ github: checked })
  }

  const handleGoogleChange = (checked: boolean) => {
    setGoogleEnabled(checked)
    saveOAuthConfig({ google: checked })
  }

  return (
    <div className="space-y-3">
      {/* Email */}
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <EnvelopeIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="email-toggle" className="text-sm font-medium cursor-pointer">
                Email
              </Label>
              {isLastEnabledMethod(emailEnabled) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>At least one authentication method must be enabled</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Sign in with magic link codes</p>
          </div>
        </div>
        <Switch
          id="email-toggle"
          checked={emailEnabled}
          onCheckedChange={handleEmailChange}
          disabled={saving || isPending || isLastEnabledMethod(emailEnabled)}
          aria-label="Email authentication"
        />
      </div>

      {/* GitHub */}
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <GitHubIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="github-toggle" className="text-sm font-medium cursor-pointer">
                GitHub
              </Label>
              {isLastEnabledMethod(githubEnabled) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>At least one authentication method must be enabled</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Allow users to sign in with GitHub</p>
          </div>
        </div>
        <Switch
          id="github-toggle"
          checked={githubEnabled}
          onCheckedChange={handleGithubChange}
          disabled={saving || isPending || isLastEnabledMethod(githubEnabled)}
        />
      </div>

      {/* Google */}
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <GoogleIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="google-toggle" className="text-sm font-medium cursor-pointer">
                Google
              </Label>
              {isLastEnabledMethod(googleEnabled) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>At least one authentication method must be enabled</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Allow users to sign in with Google</p>
          </div>
        </div>
        <Switch
          id="google-toggle"
          checked={googleEnabled}
          onCheckedChange={handleGoogleChange}
          disabled={saving || isPending || isLastEnabledMethod(googleEnabled)}
        />
      </div>

      {/* Saving indicator */}
      {(saving || isPending) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}
    </div>
  )
}
