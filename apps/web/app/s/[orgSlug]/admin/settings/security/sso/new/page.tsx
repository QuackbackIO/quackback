import Link from 'next/link'
import { requireTenantRoleBySlug } from '@/lib/tenant'
import { ArrowLeft, Building2, Settings2 } from 'lucide-react'
import { getOrderedProviderTemplates } from '@/lib/sso-provider-templates'
import { cn } from '@/lib/utils'

// Group providers by category
const PROVIDER_CATEGORIES = {
  enterprise: ['okta', 'azure', 'google_workspace', 'onelogin', 'jumpcloud', 'auth0', 'ping'],
  custom: ['custom_oidc', 'custom_saml'],
} as const

export default async function NewSsoProviderPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

  const templates = getOrderedProviderTemplates()

  const enterpriseProviders = templates.filter((t) =>
    PROVIDER_CATEGORIES.enterprise.includes(t.id as never)
  )
  const customProviders = templates.filter((t) =>
    PROVIDER_CATEGORIES.custom.includes(t.id as never)
  )

  return (
    <div className="space-y-6">
      {/* Header with back link */}
      <div>
        <Link
          href="/admin/settings/security"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Security
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Add SSO Provider</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select an identity provider to configure enterprise SSO for your organization.
        </p>
      </div>

      {/* Enterprise Providers */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Identity Providers
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {enterpriseProviders.map((template) => (
            <Link
              key={template.id}
              href={`/admin/settings/security/sso/new/${template.id}`}
              className="group flex items-start gap-4 rounded-xl border border-border/50 bg-card p-4 shadow-sm transition-all hover:border-border hover:shadow-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-base font-semibold">
                {template.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                    {template.name}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                      template.type === 'oidc'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                    )}
                  >
                    {template.type}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Custom Providers */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Custom
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {customProviders.map((template) => (
            <Link
              key={template.id}
              href={`/admin/settings/security/sso/new/${template.id}`}
              className="group flex items-start gap-4 rounded-xl border border-border/50 bg-card p-4 shadow-sm transition-all hover:border-border hover:shadow-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-base font-semibold">
                {template.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                    {template.name}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                      template.type === 'oidc'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                    )}
                  >
                    {template.type}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
