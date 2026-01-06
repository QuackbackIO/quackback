import { createFileRoute } from '@tanstack/react-router'
import { useWorkspaceFeatures } from '@/lib/hooks/use-features'
import { Badge } from '@/components/ui/badge'
import { ENTERPRISE_ONLY_FEATURES, Feature } from '@/lib/features'
import { Check, X, KeyRound, Shield, Users, ClipboardList } from 'lucide-react'

export const Route = createFileRoute('/admin/settings/license')({
  beforeLoad: async () => {
    // License page is only for self-hosted deployments
    const { requireSelfHosted } = await import('@/lib/server-functions/workspace-utils')
    await requireSelfHosted()
  },
  component: LicensePage,
})

function LicensePage() {
  const { data, isLoading } = useWorkspaceFeatures()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">License</h1>
          <p className="text-muted-foreground mt-1">Loading license information...</p>
        </div>
      </div>
    )
  }

  const tier = data?.selfHostedTier ?? 'community'
  const isEnterprise = data?.hasEnterprise ?? false
  const license = data?.license

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">License</h1>
        <p className="text-muted-foreground mt-1">
          Manage your Quackback license for enterprise features.
        </p>
      </div>

      {/* Current License Status */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <h2 className="font-semibold">Current License</h2>
          <Badge variant={isEnterprise ? 'default' : 'secondary'}>
            {tier === 'enterprise' ? 'Enterprise' : 'Community'}
          </Badge>
        </div>
        <div className="p-6">
          {isEnterprise && license ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <KeyRound className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Enterprise License Active</p>
                  <p className="text-sm text-muted-foreground">
                    Licensed to: {license.licensee || 'Unknown'}
                  </p>
                </div>
              </div>
              {license.expiresAt && (
                <p className="text-sm text-muted-foreground">
                  Expires: {new Date(license.expiresAt).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                You are using the Community edition. Upgrade to Enterprise to unlock SSO, SCIM, and
                audit logs.
              </p>
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm font-medium mb-2">To activate an Enterprise license:</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>
                    Set the <code className="bg-muted px-1 rounded">ENTERPRISE_LICENSE_KEY</code>{' '}
                    environment variable
                  </li>
                  <li>Restart the application</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Feature Comparison */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50">
          <h2 className="font-semibold">Feature Comparison</h2>
        </div>
        <div className="divide-y divide-border/50">
          <FeatureRow
            icon={<Shield className="h-4 w-4" />}
            label="SSO / SAML"
            description="Single sign-on with your identity provider"
            community={false}
            enterprise={true}
            current={tier}
          />
          <FeatureRow
            icon={<Users className="h-4 w-4" />}
            label="SCIM Provisioning"
            description="Automated user provisioning and deprovisioning"
            community={false}
            enterprise={true}
            current={tier}
          />
          <FeatureRow
            icon={<ClipboardList className="h-4 w-4" />}
            label="Audit Logs"
            description="Track all user actions for compliance"
            community={false}
            enterprise={true}
            current={tier}
          />
        </div>
      </div>

      {/* All Features Available */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50">
          <h2 className="font-semibold">All Features</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Community edition includes unlimited boards, posts, and team members.
          </p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-2">
            {Object.values(Feature)
              .filter((f) => !ENTERPRISE_ONLY_FEATURES.includes(f))
              .slice(0, 12)
              .map((feature) => (
                <div key={feature} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="capitalize">{feature.replace(/_/g, ' ')}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface FeatureRowProps {
  icon: React.ReactNode
  label: string
  description: string
  community: boolean
  enterprise: boolean
  current: 'community' | 'enterprise'
}

function FeatureRow({ icon, label, description, community, enterprise }: FeatureRowProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-center w-20">
          <p className="text-xs text-muted-foreground mb-1">Community</p>
          {community ? (
            <Check className="h-4 w-4 text-green-500 mx-auto" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground/50 mx-auto" />
          )}
        </div>
        <div className="text-center w-20">
          <p className="text-xs text-muted-foreground mb-1">Enterprise</p>
          {enterprise ? (
            <Check className="h-4 w-4 text-green-500 mx-auto" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground/50 mx-auto" />
          )}
        </div>
      </div>
    </div>
  )
}
