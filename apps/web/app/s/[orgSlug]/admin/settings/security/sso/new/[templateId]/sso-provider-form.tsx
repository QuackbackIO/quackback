'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createSsoProviderSchema, type CreateSsoProviderInput } from '@/lib/schemas/sso-providers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  type SsoProviderTemplate,
  buildDiscoveryUrl,
  buildIssuer,
} from '@/lib/sso-provider-templates'

interface SsoProviderFormProps {
  template: SsoProviderTemplate
  organizationId: string
  suggestedDomain?: string
}

export function SsoProviderForm({
  template,
  organizationId,
  suggestedDomain = '',
}: SsoProviderFormProps) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [templateFieldValues, setTemplateFieldValues] = useState<Record<string, string>>({})

  // Determine what type of provider this is
  const isCustomOidc = template.id === 'custom_oidc'
  const isCustomSaml = template.id === 'custom_saml'
  const isCustomProvider = isCustomOidc || isCustomSaml
  const hasDynamicFields = template.fields.length > 0

  const form = useForm<CreateSsoProviderInput>({
    resolver: standardSchemaResolver(createSsoProviderSchema),
    defaultValues: {
      type: template.type,
      issuer: template.issuer || '',
      domain: suggestedDomain,
      ...(template.type === 'oidc'
        ? {
            oidcConfig: {
              clientId: '',
              clientSecret: '',
              discoveryUrl: template.discoveryUrl || '',
            },
          }
        : {
            samlConfig: {
              ssoUrl: '',
              certificate: '',
              signRequest: false,
            },
          }),
    },
  })

  function handleTemplateFieldChange(fieldName: string, value: string) {
    const newValues = { ...templateFieldValues, [fieldName]: value }
    setTemplateFieldValues(newValues)

    // Auto-compute issuer and discovery URL from template
    const issuer = buildIssuer(template, newValues)
    const discoveryUrl = buildDiscoveryUrl(template, newValues)

    form.setValue('issuer', issuer)
    if (template.type === 'oidc') {
      form.setValue('oidcConfig.discoveryUrl', discoveryUrl)
    }
  }

  async function onSubmit(data: CreateSsoProviderInput) {
    setError('')

    try {
      const response = await fetch('/api/organization/sso-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          organizationId,
        }),
      })

      if (!response.ok) {
        const responseData = await response.json()
        throw new Error(responseData.error || 'Failed to create SSO provider')
      }

      router.push('/admin/settings/security')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create SSO provider')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {/* Template-specific fields (e.g., Okta Domain, Azure Tenant ID) */}
        {hasDynamicFields && (
          <div className="space-y-4">
            {template.fields.map((field) => (
              <div key={field.name} className="space-y-2">
                <label className="text-sm font-medium">{field.label}</label>
                <Input
                  placeholder={field.placeholder}
                  value={templateFieldValues[field.name] || ''}
                  onChange={(e) => handleTemplateFieldChange(field.name, e.target.value)}
                />
                {field.description && (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Email Domain - always shown */}
        <FormField
          control={form.control}
          name="domain"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Domain</FormLabel>
              <FormControl>
                <Input placeholder="acme.com" {...field} />
              </FormControl>
              <FormDescription>
                Users with this email domain will be redirected to this SSO provider
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* OIDC fields */}
        {template.type === 'oidc' && (
          <>
            {/* Only show Issuer & Discovery URL for custom OIDC */}
            {isCustomOidc && (
              <>
                <FormField
                  control={form.control}
                  name="issuer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Issuer URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://your-idp.com" {...field} />
                      </FormControl>
                      <FormDescription>The identity provider's issuer identifier</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="oidcConfig.discoveryUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discovery URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://your-idp.com/.well-known/openid-configuration"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>The OpenID Connect discovery endpoint</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name="oidcConfig.clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your client ID" {...field} />
                  </FormControl>
                  <FormDescription>
                    From your {isCustomProvider ? 'identity provider' : template.name} application
                    settings
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="oidcConfig.clientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Secret</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Enter your client secret" {...field} />
                  </FormControl>
                  <FormDescription>
                    From your {isCustomProvider ? 'identity provider' : template.name} application
                    settings
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {/* SAML fields */}
        {template.type === 'saml' && (
          <>
            {/* For custom SAML, show Issuer */}
            {isCustomSaml && (
              <FormField
                control={form.control}
                name="issuer"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Entity ID / Issuer</FormLabel>
                    <FormControl>
                      <Input placeholder="https://your-idp.com/saml/metadata" {...field} />
                    </FormControl>
                    <FormDescription>
                      The SAML Entity ID from your identity provider
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="samlConfig.ssoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SSO URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://your-idp.com/saml/sso" {...field} />
                  </FormControl>
                  <FormDescription>
                    The SAML Single Sign-On endpoint from your identity provider
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="samlConfig.certificate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>X.509 Certificate</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste the certificate from your identity provider..."
                      rows={6}
                      className="font-mono text-xs"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The public signing certificate (usually found in your IdP's SAML metadata)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/admin/settings/security')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Creating...' : 'Create provider'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
