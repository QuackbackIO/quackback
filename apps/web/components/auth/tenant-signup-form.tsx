'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { tenantSignupSchema, type TenantSignupInput } from '@/lib/schemas/auth'
import { OAuthButtons } from './oauth-buttons'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, InfoIcon } from 'lucide-react'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface OrgAuthConfig {
  found: boolean
  passwordEnabled: boolean
  googleEnabled: boolean
  githubEnabled: boolean
  microsoftEnabled: boolean
  openSignupEnabled: boolean
}

interface TenantSignupFormProps {
  orgSlug: string
  authConfig?: OrgAuthConfig | null
}

/**
 * Tenant Signup Form
 *
 * Used on tenant subdomains for users to join an existing organization.
 * Only works if the organization has openSignupEnabled = true.
 */
export function TenantSignupForm({ orgSlug: _orgSlug, authConfig }: TenantSignupFormProps) {
  const router = useRouter()
  const [error, setError] = useState('')

  const form = useForm<TenantSignupInput>({
    resolver: standardSchemaResolver(tenantSignupSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: TenantSignupInput) {
    setError('')

    try {
      const response = await fetch('/api/auth/tenant-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create account')
      }

      // Set the session cookie
      document.cookie = `better-auth.session_token=${result.sessionToken}; path=/; expires=${new Date(result.expiresAt).toUTCString()}; SameSite=Lax`

      // Redirect to admin
      router.push('/admin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  // Determine which auth methods to show
  const showPassword = authConfig ? authConfig.passwordEnabled : true
  const showGoogle = authConfig ? authConfig.googleEnabled : true
  const showGithub = authConfig ? authConfig.githubEnabled : true
  const showMicrosoft = authConfig ? authConfig.microsoftEnabled : true
  const showOAuth = showGoogle || showGithub || showMicrosoft
  const openSignupEnabled = authConfig?.openSignupEnabled ?? false

  // If signup is not enabled, show a message
  if (authConfig && !openSignupEnabled) {
    return (
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          Signup is not enabled for this organization. Please contact your administrator for an
          invitation.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* OAuth Buttons */}
      {showOAuth && (
        <>
          <OAuthButtons
            mode="signup"
            showGoogle={showGoogle}
            showGithub={showGithub}
            showMicrosoft={showMicrosoft}
            callbackUrl="/admin"
          />
          {showPassword && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with email
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Password Form */}
      {showPassword && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Min. 8 characters" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create account'
              )}
            </Button>
          </form>
        </Form>
      )}

      {/* No auth methods available */}
      {!showPassword && !showOAuth && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            No signup methods are configured for this organization. Please contact your
            administrator.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
