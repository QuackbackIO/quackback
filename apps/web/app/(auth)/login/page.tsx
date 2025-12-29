import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'
import { settingsService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { getSettings } from '@/lib/tenant'

/**
 * Portal Login Page
 *
 * For portal users (visitors) to sign in using magic OTP codes or OAuth.
 */
export default async function LoginPage() {
  const settings = await getSettings()
  if (!settings) {
    redirect('/workspace-not-found')
  }

  // Fetch portal config to determine which OAuth providers are enabled
  const configResult = await settingsService.getPublicPortalConfig()
  const oauthConfig = configResult.success ? configResult.value.oauth : DEFAULT_PORTAL_CONFIG.oauth

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to your account</p>
        </div>
        <OTPAuthForm
          mode="login"
          callbackUrl="/"
          context="portal"
          orgSlug={settings.slug}
          oauthConfig={oauthConfig}
        />
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
