'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { signIn, signOut, getSession } from '@/lib/auth/client'
import { loginSchema, type LoginInput } from '@/lib/schemas/auth'
import { OAuthButtons } from './oauth-buttons'
import { SsoLoginButton } from './sso-login-button'
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

interface SsoProviderInfo {
  providerId: string
  issuer: string
  domain: string
}

interface OrgAuthConfig {
  found: boolean
  passwordEnabled: boolean
  googleEnabled: boolean
  githubEnabled: boolean
  microsoftEnabled: boolean
  ssoProviders: SsoProviderInfo[]
}

interface LoginFormProps {
  orgSlug?: string
}

export function LoginForm({ orgSlug }: LoginFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/admin'
  const [error, setError] = useState('')
  const [ssoProvider, setSsoProvider] = useState<SsoProviderInfo | null>(null)
  const [authConfig, setAuthConfig] = useState<OrgAuthConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(!!orgSlug)

  const form = useForm<LoginInput>({
    resolver: standardSchemaResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  // Fetch org auth config if orgSlug is provided
  useEffect(() => {
    if (!orgSlug) {
      setLoadingConfig(false)
      return
    }

    async function fetchAuthConfig() {
      try {
        const response = await fetch(`/api/auth/org-auth-config?slug=${orgSlug}`)
        if (response.ok) {
          const data = await response.json()
          setAuthConfig(data)

          // If org has SSO providers, set the first one for display
          if (data.ssoProviders?.length > 0) {
            setSsoProvider(data.ssoProviders[0])
          }
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
  // Better Auth's sign-in endpoint returns "already authenticated" if any cookie exists,
  // even if the session is invalid, so we proactively clear stale cookies here
  useEffect(() => {
    async function clearStaleSession() {
      try {
        // Check if session cookie exists (client-side check)
        const hasSessionCookie =
          document.cookie.includes('better-auth.session_token') ||
          document.cookie.includes('better-auth.session_data')
        if (!hasSessionCookie) return

        // Verify if the session is actually valid by calling getSession
        const session = await getSession()
        if (!session?.data?.user) {
          // Cookie exists but session is invalid - clear it
          await signOut()
        }
      } catch {
        // If getSession fails, the session is likely invalid - clear it
        await signOut()
      }
    }

    clearStaleSession()
  }, [])

  // Check if email domain has SSO configured
  const checkSsoForEmail = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) {
      setSsoProvider(null)
      return
    }

    try {
      const response = await fetch('/api/auth/sso-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.hasSso) {
          setSsoProvider({
            providerId: data.providerId,
            issuer: data.issuer,
            domain: data.domain,
          })
        } else {
          setSsoProvider(null)
        }
      }
    } catch {
      // Silently fail - SSO check is optional
      setSsoProvider(null)
    } finally {
      // SSO check complete
    }
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

      router.push(callbackUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
    }
  }

  // Determine which auth methods to show
  const showPassword = authConfig ? authConfig.passwordEnabled : true
  const showGoogle = authConfig ? authConfig.googleEnabled : true
  const showGithub = authConfig ? authConfig.githubEnabled : true
  const showMicrosoft = authConfig ? authConfig.microsoftEnabled : true
  const showOAuth = showGoogle || showGithub || showMicrosoft

  // Loading state while fetching org config
  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // If no auth methods are enabled, show an error
  const noAuthMethods = !showPassword && !showOAuth && !authConfig?.ssoProviders?.length
  if (noAuthMethods) {
    return (
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          No authentication methods are configured for this organization. Please contact your
          administrator.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* SSO Providers (if org has configured SSO) */}
      {authConfig?.ssoProviders && authConfig.ssoProviders.length > 0 && (
        <>
          <div className="space-y-3">
            {authConfig.ssoProviders.map((provider) => (
              <SsoLoginButton
                key={provider.providerId}
                providerId={provider.providerId}
                issuer={provider.issuer}
                callbackUrl={callbackUrl}
              />
            ))}
          </div>
          {(showOAuth || showPassword) && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* OAuth Buttons */}
      {showOAuth && (
        <>
          <OAuthButtons
            mode="signin"
            showGoogle={showGoogle}
            showGithub={showGithub}
            showMicrosoft={showMicrosoft}
            callbackUrl={callbackUrl}
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
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      {...field}
                      onBlur={(e) => {
                        field.onBlur()
                        // Only check SSO if we don't have org config (fallback for app.* domain)
                        if (!authConfig) {
                          checkSsoForEmail(e.target.value)
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* SSO Login Option (detected from email, only when no org config) */}
            {!authConfig && ssoProvider && (
              <div className="space-y-3">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="bg-background px-2 text-muted-foreground">
                      SSO available for @{ssoProvider.domain}
                    </span>
                  </div>
                </div>
                <SsoLoginButton
                  providerId={ssoProvider.providerId}
                  issuer={ssoProvider.issuer}
                  callbackUrl={callbackUrl}
                />
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or use password
                    </span>
                  </div>
                </div>
              </div>
            )}

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

            <div className="flex justify-end">
              <a href="/forgot-password" className="text-sm text-muted-foreground hover:underline">
                Forgot password?
              </a>
            </div>

            <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Form>
      )}
    </div>
  )
}
