import Link from 'next/link'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

interface LoginPageProps {
  params: Promise<{ orgSlug: string }>
}

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Portal Login Page
 *
 * For portal users (visitors) to sign in using magic OTP codes or OAuth.
 */
export default async function LoginPage({ params }: LoginPageProps) {
  const { orgSlug } = await params

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
          orgSlug={orgSlug}
          appDomain={APP_DOMAIN}
          showOAuth
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
