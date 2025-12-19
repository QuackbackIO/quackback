import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireTenantRoleBySlug } from '@/lib/tenant'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { SSO_PROVIDER_TEMPLATES } from '@/lib/sso-provider-templates'
import { cn } from '@/lib/utils'
import { SsoProviderForm } from './sso-provider-form'

export default async function ConfigureSsoProviderPage({
  params,
}: {
  params: Promise<{ orgSlug: string; templateId: string }>
}) {
  const { orgSlug, templateId } = await params
  const { workspace, user } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

  const template = SSO_PROVIDER_TEMPLATES[templateId]

  if (!template) {
    notFound()
  }

  // Extract domain from user's email for pre-filling
  const suggestedDomain = user.email.split('@')[1] || ''

  return (
    <div className="space-y-6">
      {/* Header with back link */}
      <div>
        <Link
          href="/admin/settings/security/sso/new"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to providers
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-base font-semibold">
            {template.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">Configure {template.name}</h1>
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
            <p className="text-sm text-muted-foreground mt-0.5">
              {template.description}
              {template.docsUrl && (
                <a
                  href={template.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center text-primary hover:underline"
                >
                  Setup guide <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <SsoProviderForm
          template={template}
          workspaceId={workspace.id}
          suggestedDomain={suggestedDomain}
        />
      </div>
    </div>
  )
}
