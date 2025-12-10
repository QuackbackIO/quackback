import Link from 'next/link'
import { organizationService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

interface SignupPageProps {
  params: Promise<{ orgSlug: string }>
}

/**
 * Portal Signup Page
 *
 * For portal visitors to create accounts using magic OTP codes.
 * Uses the organization's portal auth settings.
 * Creates member record with role='user' (portal users can vote/comment but not access admin).
 */
export default async function SignupPage({ params }: SignupPageProps) {
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
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="mt-2 text-muted-foreground">Sign up to vote and comment</p>
        </div>
        <OTPAuthForm mode="signup" authConfig={authConfig} callbackUrl="/" context="portal" />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
