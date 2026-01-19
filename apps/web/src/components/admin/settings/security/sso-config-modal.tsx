import { useState } from 'react'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { testOIDCDiscoveryFn } from '@/lib/server-functions/settings'
import type { AdminSecurityConfig } from '@/lib/settings'

interface SSOConfigModalProps {
  open: boolean
  onClose: () => void
  securityConfig: AdminSecurityConfig
  onSave: (form: SSOFormData) => Promise<void>
  onDelete: () => Promise<void>
  saving: boolean
  deleting: boolean
}

export interface SSOFormData {
  displayName: string
  issuer: string
  clientId: string
  clientSecret: string
  emailDomain: string
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

export function SSOConfigModal({
  open,
  onClose,
  securityConfig,
  onSave,
  onDelete,
  saving,
  deleting,
}: SSOConfigModalProps) {
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  const [form, setForm] = useState<SSOFormData>({
    displayName: securityConfig.sso.provider?.displayName ?? '',
    issuer: securityConfig.sso.provider?.issuer ?? '',
    clientId: securityConfig.sso.provider?.clientId ?? '',
    clientSecret: '',
    emailDomain: securityConfig.sso.provider?.emailDomain ?? '',
  })

  const isConfigured =
    securityConfig.sso.provider !== undefined && !!securityConfig.sso.provider.issuer
  const hasSecret = securityConfig.sso.provider?.hasSecret ?? false
  const isFormComplete =
    form.issuer && form.clientId && (hasSecret || form.clientSecret) && form.displayName

  const handleTestDiscovery = async () => {
    if (!form.issuer) return

    setTestStatus('testing')
    setTestError(null)

    try {
      const result = await testOIDCDiscoveryFn({ data: { issuer: form.issuer } })
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

  const handleSave = async () => {
    setTestStatus('idle')
    setTestError(null)
    await onSave(form)
    setForm((prev) => ({ ...prev, clientSecret: '' }))
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove the SSO configuration?')) {
      return
    }
    await onDelete()
  }

  const handleClose = () => {
    // Reset form to saved values
    setForm({
      displayName: securityConfig.sso.provider?.displayName ?? '',
      issuer: securityConfig.sso.provider?.issuer ?? '',
      clientId: securityConfig.sso.provider?.clientId ?? '',
      clientSecret: '',
      emailDomain: securityConfig.sso.provider?.emailDomain ?? '',
    })
    setTestStatus('idle')
    setTestError(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(openState) => !openState && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure Single Sign-On</DialogTitle>
          <DialogDescription>
            Connect your identity provider to let team members sign in with their corporate
            accounts.
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
              value={form.displayName}
              onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Shown as &quot;Continue with {form.displayName || '...'}&quot; on the login page
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
                value={form.issuer}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, issuer: e.target.value }))
                  setTestStatus('idle')
                }}
                disabled={saving}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestDiscovery}
                disabled={!form.issuer || testStatus === 'testing' || saving}
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
                value={form.clientId}
                onChange={(e) => setForm((prev) => ({ ...prev, clientId: e.target.value }))}
                disabled={saving}
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
                value={form.clientSecret}
                onChange={(e) => setForm((prev) => ({ ...prev, clientSecret: e.target.value }))}
                disabled={saving}
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
              value={form.emailDomain}
              onChange={(e) => setForm((prev) => ({ ...prev, emailDomain: e.target.value }))}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Only allow users with this email domain to sign in
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between">
          <div>
            {isConfigured && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {deleting ? (
                  <ArrowPathIcon className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <TrashIcon className="mr-1.5 h-4 w-4" />
                )}
                Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={!isFormComplete || saving}>
              {saving && <ArrowPathIcon className="mr-1.5 h-4 w-4 animate-spin" />}
              {saving ? 'Saving...' : isConfigured ? 'Save Changes' : 'Save & Enable'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
