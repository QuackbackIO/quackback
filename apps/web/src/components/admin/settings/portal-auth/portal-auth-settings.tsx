import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  EnvelopeIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  updatePortalConfigFn,
  updateOIDCConfigFn,
  deleteOIDCConfigFn,
  testOIDCDiscoveryFn,
} from '@/lib/server/functions/settings'
import type { AdminOIDCConfig } from '@/lib/server/domains/settings'
import { GitHubIcon, GoogleIcon } from '@/components/icons/social-icons'

interface PortalAuthSettingsProps {
  initialConfig: {
    oauth: { email?: boolean; google: boolean; github: boolean }
  }
  oidcConfig: AdminOIDCConfig | null
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

function TestButtonIcon({ status }: { status: TestStatus }): React.ReactNode {
  switch (status) {
    case 'testing':
      return <ArrowPathIcon className="h-4 w-4 animate-spin" />
    case 'success':
      return <CheckCircleIcon className="h-4 w-4 text-green-500" />
    case 'error':
      return <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
    default:
      return 'Test'
  }
}

function OpenIDIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  )
}

export function PortalAuthSettings({ initialConfig, oidcConfig }: PortalAuthSettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(initialConfig.oauth.email ?? true)
  const [githubEnabled, setGithubEnabled] = useState(initialConfig.oauth.github)
  const [googleEnabled, setGoogleEnabled] = useState(initialConfig.oauth.google)

  // OIDC state
  const [oidcEnabled, setOidcEnabled] = useState(oidcConfig?.enabled ?? false)
  const [oidcModalOpen, setOidcModalOpen] = useState(false)
  const [oidcSaving, setOidcSaving] = useState(false)
  const [oidcDeleting, setOidcDeleting] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  const [oidcForm, setOidcForm] = useState({
    displayName: oidcConfig?.displayName ?? '',
    issuer: oidcConfig?.issuer ?? '',
    clientId: oidcConfig?.clientId ?? '',
    clientSecret: '',
    emailDomain: oidcConfig?.emailDomain ?? '',
  })

  const isOidcConfigured = oidcConfig !== null && !!oidcConfig.issuer
  const hasSecret = oidcConfig?.hasSecret ?? false
  const isOidcFormComplete =
    oidcForm.issuer &&
    oidcForm.clientId &&
    (hasSecret || oidcForm.clientSecret) &&
    oidcForm.displayName

  // Count enabled auth methods to prevent disabling the last one
  const enabledMethodCount = [emailEnabled, githubEnabled, googleEnabled, oidcEnabled].filter(
    Boolean
  ).length
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

  const handleOidcEnabledChange = async (checked: boolean) => {
    if (!isOidcConfigured) {
      // Not configured yet - open modal
      setOidcModalOpen(true)
      return
    }

    // Prevent disabling if it's the last enabled method
    if (!checked && isLastEnabledMethod(oidcEnabled)) {
      return
    }

    // Already configured - toggle enabled state
    setOidcEnabled(checked)
    setOidcSaving(true)
    try {
      await updateOIDCConfigFn({ data: { enabled: checked } })
      startTransition(() => {
        router.invalidate()
      })
    } catch (error) {
      console.error('Failed to toggle OIDC:', error)
      setOidcEnabled(!checked) // Revert on error
    } finally {
      setOidcSaving(false)
    }
  }

  const handleTestDiscovery = async () => {
    if (!oidcForm.issuer) return

    setTestStatus('testing')
    setTestError(null)

    try {
      const result = await testOIDCDiscoveryFn({ data: { issuer: oidcForm.issuer } })
      if (result.success) {
        setTestStatus('success')
      } else {
        setTestStatus('error')
        setTestError(result.error)
      }
    } catch (error) {
      setTestStatus('error')
      setTestError(error instanceof Error ? error.message : 'Test failed')
    }
  }

  const handleOidcSave = async () => {
    setOidcSaving(true)
    setTestStatus('idle')
    setTestError(null)

    try {
      await updateOIDCConfigFn({
        data: {
          enabled: true, // Enable when saving new config
          displayName: oidcForm.displayName || undefined,
          issuer: oidcForm.issuer || undefined,
          clientId: oidcForm.clientId || undefined,
          clientSecret: oidcForm.clientSecret || undefined,
          emailDomain: oidcForm.emailDomain || undefined,
        },
      })

      setOidcForm((prev) => ({ ...prev, clientSecret: '' }))
      setOidcEnabled(true)
      setOidcModalOpen(false)

      startTransition(() => {
        router.invalidate()
      })
    } catch (error) {
      console.error('Failed to save OIDC config:', error)
    } finally {
      setOidcSaving(false)
    }
  }

  const handleOidcDelete = async () => {
    if (!confirm('Are you sure you want to remove the OIDC configuration?')) {
      return
    }

    setOidcDeleting(true)
    try {
      await deleteOIDCConfigFn()
      setOidcForm({
        displayName: '',
        issuer: '',
        clientId: '',
        clientSecret: '',
        emailDomain: '',
      })
      setOidcEnabled(false)
      setOidcModalOpen(false)
      startTransition(() => {
        router.invalidate()
      })
    } catch (error) {
      console.error('Failed to delete OIDC config:', error)
    } finally {
      setOidcDeleting(false)
    }
  }

  const handleOidcModalClose = () => {
    // Reset form to saved values
    setOidcForm({
      displayName: oidcConfig?.displayName ?? '',
      issuer: oidcConfig?.issuer ?? '',
      clientId: oidcConfig?.clientId ?? '',
      clientSecret: '',
      emailDomain: oidcConfig?.emailDomain ?? '',
    })
    setTestStatus('idle')
    setTestError(null)
    setOidcModalOpen(false)
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

      {/* OpenID Connect */}
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <OpenIDIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="oidc-toggle" className="text-sm font-medium cursor-pointer">
                Custom OpenID Connect
              </Label>
              {isLastEnabledMethod(oidcEnabled) && (
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
            <p className="text-xs text-muted-foreground">
              {isOidcConfigured
                ? `${oidcConfig.displayName} via ${new URL(oidcConfig.issuer).hostname}`
                : 'Configure your own identity provider (Okta, Auth0, etc.)'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOidcModalOpen(true)}
            className="h-8 px-2"
          >
            <Cog6ToothIcon className="h-4 w-4" />
            <span className="sr-only">Configure</span>
          </Button>
          <Switch
            id="oidc-toggle"
            checked={oidcEnabled}
            onCheckedChange={handleOidcEnabledChange}
            disabled={oidcSaving || isPending || isLastEnabledMethod(oidcEnabled)}
          />
        </div>
      </div>

      {/* Saving indicator */}
      {(saving || isPending || oidcSaving) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {/* OIDC Configuration Modal */}
      <Dialog open={oidcModalOpen} onOpenChange={(open) => !open && handleOidcModalClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure OpenID Connect</DialogTitle>
            <DialogDescription>
              Connect your identity provider to let users sign in with their existing accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Display Name */}
            <div className="space-y-2">
              <Label htmlFor="displayName" className="text-sm font-medium">
                Button Label <span className="text-destructive">*</span>
              </Label>
              <Input
                id="displayName"
                placeholder="e.g., Acme Corp SSO"
                value={oidcForm.displayName}
                onChange={(e) => setOidcForm((prev) => ({ ...prev, displayName: e.target.value }))}
                disabled={oidcSaving}
              />
              <p className="text-xs text-muted-foreground">
                Shown as &quot;Continue with {oidcForm.displayName || '...'}&quot; on the login page
              </p>
            </div>

            {/* Issuer URL */}
            <div className="space-y-2">
              <Label htmlFor="issuer" className="text-sm font-medium">
                Issuer URL <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="issuer"
                  placeholder="https://your-tenant.okta.com"
                  value={oidcForm.issuer}
                  onChange={(e) => {
                    setOidcForm((prev) => ({ ...prev, issuer: e.target.value }))
                    setTestStatus('idle')
                  }}
                  disabled={oidcSaving}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestDiscovery}
                  disabled={!oidcForm.issuer || testStatus === 'testing' || oidcSaving}
                  className="shrink-0"
                >
                  <TestButtonIcon status={testStatus} />
                </Button>
              </div>
              {testStatus === 'success' && (
                <p className="text-xs text-green-600">Valid OIDC provider - endpoints verified</p>
              )}
              {testStatus === 'error' && testError && (
                <p className="text-xs text-red-600">{testError}</p>
              )}
            </div>

            {/* Client credentials */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clientId" className="text-sm font-medium">
                  Client ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="clientId"
                  placeholder="your-client-id"
                  value={oidcForm.clientId}
                  onChange={(e) => setOidcForm((prev) => ({ ...prev, clientId: e.target.value }))}
                  disabled={oidcSaving}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientSecret" className="text-sm font-medium">
                  Client Secret {!hasSecret && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="clientSecret"
                  type="password"
                  placeholder={hasSecret ? '••••••••••••••••' : 'your-client-secret'}
                  value={oidcForm.clientSecret}
                  onChange={(e) =>
                    setOidcForm((prev) => ({ ...prev, clientSecret: e.target.value }))
                  }
                  disabled={oidcSaving}
                />
                {hasSecret && (
                  <p className="text-xs text-muted-foreground">Leave empty to keep existing</p>
                )}
              </div>
            </div>

            {/* Email domain restriction */}
            <div className="space-y-2">
              <Label htmlFor="emailDomain" className="text-sm font-medium">
                Email Domain Restriction
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="emailDomain"
                placeholder="acme.com"
                value={oidcForm.emailDomain}
                onChange={(e) => setOidcForm((prev) => ({ ...prev, emailDomain: e.target.value }))}
                disabled={oidcSaving}
              />
              <p className="text-xs text-muted-foreground">
                Only allow users with this email domain to sign in
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between">
            <div>
              {isOidcConfigured && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleOidcDelete}
                  disabled={oidcDeleting || oidcSaving}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  {oidcDeleting ? (
                    <ArrowPathIcon className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <TrashIcon className="mr-1.5 h-4 w-4" />
                  )}
                  Remove
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleOidcModalClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleOidcSave}
                disabled={!isOidcFormComplete || oidcSaving}
              >
                {oidcSaving && <ArrowPathIcon className="mr-1.5 h-4 w-4 animate-spin" />}
                {oidcSaving ? 'Saving...' : isOidcConfigured ? 'Save Changes' : 'Save & Enable'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
