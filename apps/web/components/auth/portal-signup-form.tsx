'use client'

import { useState, useEffect } from 'react'
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

interface PortalAuthConfig {
  found: boolean
  portalAuthEnabled: boolean
  passwordEnabled: boolean
  googleEnabled: boolean
  githubEnabled: boolean
  requireAuth: boolean
}

interface PortalSignupFormProps {
  orgSlug: string
}

/**
 * Portal Signup Form
 *
 * For portal users to create accounts on the public portal.
 * Uses the organization's portal auth settings.
 * Creates users with role='user' (portal-only access, no admin).
 */
export function PortalSignupForm({ orgSlug }: PortalSignupFormProps) {
  const [error, setError] = useState('')
  const [authConfig, setAuthConfig] = useState<PortalAuthConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)

  const form = useForm<TenantSignupInput>({
    resolver: standardSchemaResolver(tenantSignupSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  })

  // Fetch portal auth config
  useEffect(() => {
    async function fetchAuthConfig() {
      try {
        const response = await fetch(`/api/auth/portal-auth-config?slug=${orgSlug}`)
        if (response.ok) {
          const data = await response.json()
          setAuthConfig(data)
        }
      } catch {
        // Silently fail - use defaults
      } finally {
        setLoadingConfig(false)
      }
    }

    fetchAuthConfig()
  }, [orgSlug])

  async function onSubmit(data: TenantSignupInput) {
    setError('')

    try {
      const response = await fetch('/api/auth/portal-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create account')
      }

      // Redirect to trust-login to get proper signed session cookie
      window.location.href = result.redirectUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  // Determine which auth methods to show
  const showPassword = authConfig ? authConfig.passwordEnabled : true
  const showGoogle = authConfig ? authConfig.googleEnabled : true
  const showGithub = authConfig ? authConfig.githubEnabled : true
  const showOAuth = showGoogle || showGithub

  // Loading state while fetching config
  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // If portal auth is disabled
  if (authConfig && !authConfig.portalAuthEnabled) {
    return (
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          User accounts are not enabled for this portal. You can still interact anonymously.
        </AlertDescription>
      </Alert>
    )
  }

  // If no auth methods are enabled
  const noAuthMethods = !showPassword && !showOAuth
  if (noAuthMethods) {
    return (
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          No signup methods are configured for this portal. Please contact the administrator.
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
            showMicrosoft={false}
            callbackUrl="/"
            context="portal"
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
    </div>
  )
}
