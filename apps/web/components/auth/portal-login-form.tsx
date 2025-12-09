'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { signIn, signOut, getSession } from '@/lib/auth/client'
import { loginSchema, type LoginInput } from '@/lib/schemas/auth'
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

interface PortalLoginFormProps {
  orgSlug?: string
}

/**
 * Portal Login Form
 *
 * For portal users (role='user') to sign in to interact with the public portal.
 * Uses the organization's portal auth settings (portalPasswordEnabled, portalGoogleEnabled, etc.)
 */
export function PortalLoginForm({ orgSlug }: PortalLoginFormProps) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [authConfig, setAuthConfig] = useState<PortalAuthConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(!!orgSlug)

  const form = useForm<LoginInput>({
    resolver: standardSchemaResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  // Fetch portal auth config if orgSlug is provided
  useEffect(() => {
    if (!orgSlug) {
      setLoadingConfig(false)
      return
    }

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

  // Clear stale session cookies on mount
  // This handles the case where a cookie exists but the session is invalid/expired in the DB
  useEffect(() => {
    async function clearStaleSession() {
      try {
        const hasSessionCookie =
          document.cookie.includes('better-auth.session_token') ||
          document.cookie.includes('better-auth.session_data')
        if (!hasSessionCookie) return

        const session = await getSession()
        if (!session?.data?.user) {
          await signOut()
        }
      } catch {
        await signOut()
      }
    }

    clearStaleSession()
  }, [])

  async function onSubmit(data: LoginInput) {
    setError('')

    try {
      const { error: signInError } = await signIn.email({
        email: data.email,
        password: data.password,
      })

      if (signInError) {
        throw new Error(signInError.message)
      }

      // Redirect to portal home
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
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
          No login methods are configured for this portal. Please contact the administrator.
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
            mode="signin"
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
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Form>
      )}
    </div>
  )
}
