import Link from 'next/link'
import { organizationService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

interface LoginPageProps {
  params: Promise<{ orgSlug: string }>
}

/**
 * Portal Login Page
 *
 * For portal users (visitors) to sign in using magic OTP codes.
 * Uses the organization's portal auth settings.
 */
export default async function LoginPage({ params }: LoginPageProps) {
  const { orgSlug } = await params

  // Fetch portal config using the service
  const result = await organizationService.getPublicPortalConfig(orgSlug)

  const authConfig = result.success
    ? {
        found: true,
        oauth: result.value.oauth,
      }
    : {
        found: false,
        oauth: DEFAULT_PORTAL_CONFIG.oauth,
      }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to your account</p>
        </div>
        <OTPAuthForm mode="login" authConfig={authConfig} callbackUrl="/" context="portal" />
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
