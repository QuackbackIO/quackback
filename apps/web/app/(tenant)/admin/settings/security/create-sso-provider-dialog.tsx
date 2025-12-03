'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createSsoProviderSchema, type CreateSsoProviderInput } from '@/lib/schemas/sso-providers'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, ArrowLeft, ExternalLink, Building2, Globe, Settings2 } from 'lucide-react'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  type SsoProviderTemplate,
  getOrderedProviderTemplates,
  buildDiscoveryUrl,
  buildIssuer,
} from '@/lib/sso-provider-templates'

// Group providers by category for better organization
const PROVIDER_CATEGORIES = {
  enterprise: ['okta', 'azure', 'google_workspace', 'onelogin', 'jumpcloud', 'auth0', 'ping'],
  social: ['google'],
  custom: ['custom_oidc', 'custom_saml'],
} as const

// Compact provider button component
function ProviderButton({
  template,
  onClick,
}: {
  template: SsoProviderTemplate
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors',
        'hover:border-border hover:bg-accent'
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-sm font-semibold">
        {template.name.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{template.name}</div>
      </div>
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
    </button>
  )
}

interface CreateSsoProviderDialogProps {
  organizationId: string
  onSuccess?: () => void
}

export function CreateSsoProviderDialog({
  organizationId,
  onSuccess,
}: CreateSsoProviderDialogProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'select' | 'configure'>('select')
  const [selectedTemplate, setSelectedTemplate] = useState<SsoProviderTemplate | null>(null)
  const [templateFieldValues, setTemplateFieldValues] = useState<Record<string, string>>({})

  const form = useForm<CreateSsoProviderInput>({
    resolver: standardSchemaResolver(createSsoProviderSchema),
    defaultValues: {
      type: 'oidc',
      issuer: '',
      domain: '',
      oidcConfig: {
        clientId: '',
        clientSecret: '',
        discoveryUrl: '',
      },
    },
  })

  const templates = getOrderedProviderTemplates()

  function selectTemplate(template: SsoProviderTemplate) {
    setSelectedTemplate(template)
    setTemplateFieldValues({})

    // Reset form with template defaults
    form.reset({
      type: template.type,
      issuer: template.issuer || '',
      domain: '',
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
    })

    // If template has no dynamic fields, go straight to configure
    if (template.fields.length === 0) {
      setStep('configure')
    } else {
      setStep('configure')
    }
  }

  function handleTemplateFieldChange(fieldName: string, value: string) {
    const newValues = { ...templateFieldValues, [fieldName]: value }
    setTemplateFieldValues(newValues)

    if (selectedTemplate) {
      // Update issuer and discovery URL based on template
      const issuer = buildIssuer(selectedTemplate, newValues)
      const discoveryUrl = buildDiscoveryUrl(selectedTemplate, newValues)

      form.setValue('issuer', issuer)
      if (selectedTemplate.type === 'oidc') {
        form.setValue('oidcConfig.discoveryUrl', discoveryUrl)
      }
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

      setOpen(false)
      form.reset()
      setStep('select')
      setSelectedTemplate(null)
      setTemplateFieldValues({})
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create SSO provider')
    }
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      form.reset()
      setError('')
      setStep('select')
      setSelectedTemplate(null)
      setTemplateFieldValues({})
    }
  }

  function goBack() {
    setStep('select')
    setSelectedTemplate(null)
    setTemplateFieldValues({})
    form.reset()
  }

  const isCustomProvider =
    selectedTemplate?.id === 'custom_oidc' || selectedTemplate?.id === 'custom_saml'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Add Provider
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        {step === 'select' ? (
          <>
            <DialogHeader>
              <DialogTitle>Add SSO Provider</DialogTitle>
              <DialogDescription>
                Select an identity provider to configure enterprise SSO.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-4 py-2">
                {/* Enterprise Providers */}
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    Enterprise
                  </div>
                  <div className="space-y-1">
                    {templates
                      .filter((t) => PROVIDER_CATEGORIES.enterprise.includes(t.id as never))
                      .map((template) => (
                        <ProviderButton
                          key={template.id}
                          template={template}
                          onClick={() => selectTemplate(template)}
                        />
                      ))}
                  </div>
                </div>

                {/* Social Providers */}
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Globe className="h-3 w-3" />
                    Social
                  </div>
                  <div className="space-y-1">
                    {templates
                      .filter((t) => PROVIDER_CATEGORIES.social.includes(t.id as never))
                      .map((template) => (
                        <ProviderButton
                          key={template.id}
                          template={template}
                          onClick={() => selectTemplate(template)}
                        />
                      ))}
                  </div>
                </div>

                {/* Custom Providers */}
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Settings2 className="h-3 w-3" />
                    Custom
                  </div>
                  <div className="space-y-1">
                    {templates
                      .filter((t) => PROVIDER_CATEGORIES.custom.includes(t.id as never))
                      .map((template) => (
                        <ProviderButton
                          key={template.id}
                          template={template}
                          onClick={() => selectTemplate(template)}
                        />
                      ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={goBack}
                    className="h-8 w-8"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div>
                    <DialogTitle>Configure {selectedTemplate?.name}</DialogTitle>
                    <DialogDescription>
                      {selectedTemplate?.description}
                      {selectedTemplate?.docsUrl && (
                        <a
                          href={selectedTemplate.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 inline-flex items-center text-primary hover:underline"
                        >
                          Setup guide <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      )}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-4 py-4 pr-4">
                  {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  {/* Template-specific fields */}
                  {selectedTemplate &&
                    selectedTemplate.fields.length > 0 &&
                    selectedTemplate.fields.map((field) => (
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

                  {/* Common fields */}
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
                          Users with this email domain will use this SSO provider
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Issuer - show for custom or as read-only for templates */}
                  <FormField
                    control={form.control}
                    name="issuer"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Issuer URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://accounts.google.com"
                            {...field}
                            readOnly={!isCustomProvider && selectedTemplate?.fields.length === 0}
                            className={
                              !isCustomProvider && selectedTemplate?.fields.length === 0
                                ? 'bg-muted'
                                : ''
                            }
                          />
                        </FormControl>
                        <FormDescription>The identity provider issuer URL</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* OIDC-specific fields */}
                  {selectedTemplate?.type === 'oidc' && (
                    <>
                      <FormField
                        control={form.control}
                        name="oidcConfig.clientId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Client ID</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormDescription>
                              The OAuth client ID from your identity provider
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
                              <Input type="password" {...field} />
                            </FormControl>
                            <FormDescription>
                              The OAuth client secret from your identity provider
                            </FormDescription>
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
                                placeholder="https://.../.well-known/openid-configuration"
                                {...field}
                                readOnly={
                                  !isCustomProvider && selectedTemplate?.fields.length === 0
                                }
                                className={
                                  !isCustomProvider && selectedTemplate?.fields.length === 0
                                    ? 'bg-muted'
                                    : ''
                                }
                              />
                            </FormControl>
                            <FormDescription>
                              The OIDC discovery URL to auto-configure endpoints
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  {/* SAML-specific fields */}
                  {selectedTemplate?.type === 'saml' && (
                    <>
                      <FormField
                        control={form.control}
                        name="samlConfig.ssoUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SSO URL</FormLabel>
                            <FormControl>
                              <Input placeholder="https://idp.example.com/saml/sso" {...field} />
                            </FormControl>
                            <FormDescription>The SAML SSO endpoint URL</FormDescription>
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
                                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                                rows={4}
                                className="font-mono text-xs"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              The public certificate from your identity provider
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </div>
              </ScrollArea>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? 'Creating...' : 'Create provider'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
