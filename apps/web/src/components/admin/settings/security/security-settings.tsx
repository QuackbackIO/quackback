import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowPathIcon, EnvelopeIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { updateSecurityConfigFn } from '@/lib/server/functions/settings'
import type { AdminSecurityConfig } from '@/lib/server/domains/settings'
import { GitHubIcon, GoogleIcon } from '@/components/icons/social-icons'

interface SecuritySettingsProps {
  securityConfig: AdminSecurityConfig
}

export function SecuritySettings({ securityConfig }: SecuritySettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  // Sign-in methods state
  const [emailEnabled, setEmailEnabled] = useState(securityConfig.teamSocialLogin.email ?? true)
  const [githubEnabled, setGithubEnabled] = useState(securityConfig.teamSocialLogin.github)
  const [googleEnabled, setGoogleEnabled] = useState(securityConfig.teamSocialLogin.google)

  const saveSignInConfig = async (config: {
    email?: boolean
    github?: boolean
    google?: boolean
  }) => {
    setSaving(true)
    try {
      await updateSecurityConfigFn({ data: { teamSocialLogin: config } })
      startTransition(() => {
        router.invalidate()
      })
    } finally {
      setSaving(false)
    }
  }

  const handleEmailChange = (checked: boolean) => {
    setEmailEnabled(checked)
    saveSignInConfig({ email: checked })
  }

  const handleGithubChange = (checked: boolean) => {
    setGithubEnabled(checked)
    saveSignInConfig({ github: checked })
  }

  const handleGoogleChange = (checked: boolean) => {
    setGoogleEnabled(checked)
    saveSignInConfig({ google: checked })
  }

  return (
    <div className="space-y-6">
      {/* Team Sign-in Methods */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Team Sign-in Methods</h3>

        {/* Email */}
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
              <EnvelopeIcon className="h-5 w-5" />
            </div>
            <div>
              <Label htmlFor="email-toggle" className="text-sm font-medium cursor-pointer">
                Email
              </Label>
              <p className="text-xs text-muted-foreground">Sign in with magic link codes</p>
            </div>
          </div>
          <Switch
            id="email-toggle"
            checked={emailEnabled}
            onCheckedChange={handleEmailChange}
            disabled={saving || isPending}
          />
        </div>

        {/* GitHub */}
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
              <GitHubIcon className="h-5 w-5" />
            </div>
            <div>
              <Label htmlFor="github-toggle" className="text-sm font-medium cursor-pointer">
                GitHub
              </Label>
              <p className="text-xs text-muted-foreground">Allow team to sign in with GitHub</p>
            </div>
          </div>
          <Switch
            id="github-toggle"
            checked={githubEnabled}
            onCheckedChange={handleGithubChange}
            disabled={saving || isPending}
          />
        </div>

        {/* Google */}
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
              <GoogleIcon className="h-5 w-5" />
            </div>
            <div>
              <Label htmlFor="google-toggle" className="text-sm font-medium cursor-pointer">
                Google
              </Label>
              <p className="text-xs text-muted-foreground">Allow team to sign in with Google</p>
            </div>
          </div>
          <Switch
            id="google-toggle"
            checked={googleEnabled}
            onCheckedChange={handleGoogleChange}
            disabled={saving || isPending}
          />
        </div>
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
