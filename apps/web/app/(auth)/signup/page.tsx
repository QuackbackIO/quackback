import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'
import { workspaceService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { getSettings } from '@/lib/tenant'

/**
 * Portal Signup Page
 *
 * For portal visitors to create accounts using magic OTP codes or OAuth.
 * Creates member record with role='user' (portal users can vote/comment but not access admin).
 */
export default async function SignupPage() {
  const settings = await getSettings()
  if (!settings) {
    redirect('/workspace-not-found')
  }

  // Fetch portal config to determine which OAuth providers are enabled
  const configResult = await workspaceService.getPublicPortalConfig()
  const oauthConfig = configResult.success ? configResult.value.oauth : DEFAULT_PORTAL_CONFIG.oauth

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="mt-2 text-muted-foreground">Sign up to vote and comment</p>
        </div>
        <OTPAuthForm
          mode="signup"
          callbackUrl="/"
          context="portal"
          orgSlug={settings.slug}
          oauthConfig={oauthConfig}
        />
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
