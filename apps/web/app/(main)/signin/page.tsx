import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SigninForm } from './signin-form'

/**
 * Sign In Page - Workspace Finder
 *
 * Main domain page for finding workspaces associated with an email.
 * Uses magic link (verification code) flow like Slack - no passwords.
 *
 * Flow:
 * 1. User enters email
 * 2. Code sent to email
 * 3. User enters code
 * 4. Shows list of workspaces for that email
 * 5. User clicks workspace → redirects to subdomain with session
 */
export default function SigninPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-8">
          {/* Logo/Brand */}
          <div className="flex flex-col items-center space-y-4">
            <Link href="/" className="group">
              <div className="relative">
                <div className="absolute -inset-3 bg-primary/10 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <Image
                  src="/logo.png"
                  alt="Quackback"
                  width={64}
                  height={64}
                  className="relative"
                />
              </div>
            </Link>
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Sign in to Quackback</h1>
              <p className="text-sm text-muted-foreground">
                Enter your email to find your workspaces
              </p>
            </div>
          </div>

          {/* Form Card */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
            <SigninForm />
          </div>

          {/* Create workspace link */}
          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have a workspace yet?{' '}
              <Link href="/create-workspace" className="text-primary hover:underline">
                Create one
              </Link>
            </p>

            {/* Back link */}
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
