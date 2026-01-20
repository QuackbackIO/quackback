import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  EnvelopeIcon,
  LockClosedIcon,
  Cog6ToothIcon,
  KeyIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { updateSecurityConfigFn, deleteTeamSSOConfigFn } from '@/lib/server-functions/settings'
import type { AdminSecurityConfig, SSOEnforcement } from '@/lib/settings'
import { GitHubIcon, GoogleIcon } from '@/components/icons/social-icons'
import { SSOConfigModal, type SSOFormData } from './sso-config-modal'

interface SecuritySettingsProps {
  securityConfig: AdminSecurityConfig
  hasEnterprise: boolean
  isSelfHosted: boolean
}

export function SecuritySettings({
  securityConfig,
  hasEnterprise,
  isSelfHosted,
}: SecuritySettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  // SSO state
  const [ssoEnabled, setSsoEnabled] = useState(securityConfig.sso.enabled)
  const [enforcement, setEnforcement] = useState<SSOEnforcement>(securityConfig.sso.enforcement)
  const [ssoModalOpen, setSsoModalOpen] = useState(false)
  const [ssoSaving, setSsoSaving] = useState(false)
  const [ssoDeleting, setSsoDeleting] = useState(false)

  // Sign-in methods state
  const [emailEnabled, setEmailEnabled] = useState(securityConfig.teamSocialLogin.email ?? true)
  const [githubEnabled, setGithubEnabled] = useState(securityConfig.teamSocialLogin.github)
  const [googleEnabled, setGoogleEnabled] = useState(securityConfig.teamSocialLogin.google)

  const isSsoConfigured =
    securityConfig.sso.provider !== undefined && !!securityConfig.sso.provider.issuer

  // When SSO is required, social logins are disabled
  const ssoRequired = ssoEnabled && enforcement === 'required'

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

  const handleSsoEnabledChange = async (checked: boolean) => {
    if (!hasEnterprise) return

    if (!isSsoConfigured && checked) {
      setSsoModalOpen(true)
      return
    }

    setSsoEnabled(checked)
    setSsoSaving(true)
    try {
      await updateSecurityConfigFn({
        data: {
          sso: { enabled: checked, enforcement: checked ? enforcement : 'optional' },
        },
      })
      if (!checked) {
        setEnforcement('optional')
      }
      startTransition(() => {
        router.invalidate()
      })
    } catch (error) {
      console.error('Failed to toggle SSO:', error)
      setSsoEnabled(!checked)
    } finally {
      setSsoSaving(false)
    }
  }

  const handleEnforcementChange = async (value: SSOEnforcement) => {
    setEnforcement(value)
    setSsoSaving(true)
    try {
      await updateSecurityConfigFn({
        data: { sso: { enforcement: value } },
      })
      startTransition(() => {
        router.invalidate()
      })
    } catch (error) {
      console.error('Failed to update enforcement:', error)
      setEnforcement(securityConfig.sso.enforcement)
    } finally {
      setSsoSaving(false)
    }
  }

  const handleSsoSave = async (form: SSOFormData) => {
    setSsoSaving(true)
    try {
      await updateSecurityConfigFn({
        data: {
          sso: {
            enabled: true,
            enforcement,
            provider: {
              enabled: true,
              displayName: form.displayName || undefined,
              issuer: form.issuer || undefined,
              clientId: form.clientId || undefined,
              clientSecret: form.clientSecret || undefined,
              emailDomain: form.emailDomain || undefined,
            },
          },
        },
      })
      setSsoEnabled(true)
      setSsoModalOpen(false)
      startTransition(() => {
        router.invalidate()
      })
    } catch (error) {
      console.error('Failed to save SSO config:', error)
    } finally {
      setSsoSaving(false)
    }
  }

  const handleSsoDelete = async () => {
    setSsoDeleting(true)
    try {
      await deleteTeamSSOConfigFn()
      setSsoEnabled(false)
      setEnforcement('optional')
      setSsoModalOpen(false)
      startTransition(() => {
        router.invalidate()
      })
    } catch (error) {
      console.error('Failed to delete SSO config:', error)
    } finally {
      setSsoDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* SSO Configuration Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Single Sign-On</h3>
          {!hasEnterprise && (
            // Route path typed as '/' since license/billing routes are edition-specific
            <Link
              to={(isSelfHosted ? '/admin/settings/license' : '/admin/settings/billing') as '/'}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <LockClosedIcon className="h-3 w-3" />
              Enterprise
            </Link>
          )}
        </div>

        {/* SSO Provider Row */}
        <div
          className={`flex items-center justify-between rounded-lg border border-border/50 p-4 ${!hasEnterprise ? 'opacity-60' : ''}`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
              <KeyIcon className="h-5 w-5" />
            </div>
            <div>
              <Label htmlFor="sso-toggle" className="text-sm font-medium cursor-pointer">
                {isSsoConfigured ? securityConfig.sso.provider?.displayName : 'Identity Provider'}
              </Label>
              <p className="text-xs text-muted-foreground">
                {isSsoConfigured
                  ? `Connected via ${new URL(securityConfig.sso.provider!.issuer).hostname}`
                  : 'Connect Okta, Azure AD, or any OIDC provider'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasEnterprise && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSsoModalOpen(true)}
                className="h-8 px-2"
              >
                <Cog6ToothIcon className="h-4 w-4" />
                <span className="sr-only">Configure</span>
              </Button>
            )}
            <Switch
              id="sso-toggle"
              checked={ssoEnabled}
              onCheckedChange={handleSsoEnabledChange}
              disabled={!hasEnterprise || ssoSaving || isPending}
            />
          </div>
        </div>

        {/* Enforcement Options (only shown when SSO is enabled and configured) */}
        {hasEnterprise && ssoEnabled && isSsoConfigured && (
          <div className="rounded-lg border border-border/50 p-4">
            <Label className="text-sm font-medium">Enforcement</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Control whether team members must use SSO
            </p>
            <RadioGroup
              value={enforcement}
              onValueChange={(value) => handleEnforcementChange(value as SSOEnforcement)}
              disabled={ssoSaving || isPending}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="optional" id="enforcement-optional" />
                <Label
                  htmlFor="enforcement-optional"
                  className="text-sm font-normal cursor-pointer"
                >
                  Optional - Team can use SSO or other sign-in methods
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="required" id="enforcement-required" />
                <Label
                  htmlFor="enforcement-required"
                  className="text-sm font-normal cursor-pointer"
                >
                  Required - Team must use SSO (admins can bypass via email)
                </Label>
              </div>
            </RadioGroup>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Team Sign-in Methods */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Team Sign-in Methods</h3>
          {ssoRequired && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              Disabled: SSO required
            </span>
          )}
        </div>

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
            checked={emailEnabled && !ssoRequired}
            onCheckedChange={handleEmailChange}
            disabled={saving || isPending || ssoRequired}
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
            checked={githubEnabled && !ssoRequired}
            onCheckedChange={handleGithubChange}
            disabled={saving || isPending || ssoRequired}
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
            checked={googleEnabled && !ssoRequired}
            onCheckedChange={handleGoogleChange}
            disabled={saving || isPending || ssoRequired}
          />
        </div>
      </div>

      {/* Info Alert */}
      {ssoRequired && (
        <Alert>
          <InformationCircleIcon className="h-4 w-4" />
          <AlertDescription>
            When SSO is required, all other sign-in methods are disabled for team members.
          </AlertDescription>
        </Alert>
      )}

      {/* Saving indicator */}
      {(saving || isPending || ssoSaving) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {/* SSO Configuration Modal */}
      {hasEnterprise && (
        <SSOConfigModal
          open={ssoModalOpen}
          onClose={() => setSsoModalOpen(false)}
          securityConfig={securityConfig}
          onSave={handleSsoSave}
          onDelete={handleSsoDelete}
          saving={ssoSaving}
          deleting={ssoDeleting}
        />
      )}
    </div>
  )
}
