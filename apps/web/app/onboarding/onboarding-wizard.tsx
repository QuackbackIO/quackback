'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Check,
  MessageSquare,
  ArrowRight,
  ArrowLeft,
  LayoutDashboard,
  Globe,
  Sparkles,
  Building2,
  Mail,
  User,
  Loader2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createBoardAction } from '@/lib/actions/boards'
import { setupWorkspaceAction } from '@/lib/actions/onboarding'
import { authClient } from '@/lib/auth/client'

type Step = 'create-account' | 'setup-workspace' | 'create-board' | 'complete'

interface OnboardingWizardProps {
  initialStep: Step
  workspaceName?: string | null
  userName?: string | null
}

export function OnboardingWizard({ initialStep, workspaceName, userName }: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(initialStep)

  // Account creation state
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [accountStep, setAccountStep] = useState<'email' | 'code'>('email')
  const [resendCooldown, setResendCooldown] = useState(0)

  // Name is collected in setup-workspace step if user doesn't have one
  const [name, setName] = useState('')

  // Workspace setup state
  const [wsName, setWsName] = useState('')

  // Board creation state
  const [boardName, setBoardName] = useState('')
  const [boardDescription, setBoardDescription] = useState('')

  // Shared state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentWorkspaceName, setCurrentWorkspaceName] = useState(workspaceName || '')

  const codeInputRef = useRef<HTMLInputElement>(null)

  const firstName = userName?.split(' ')[0] || name.split(' ')[0] || 'there'
  const needsName = !userName

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  // Focus code input when step changes
  useEffect(() => {
    if (accountStep === 'code' && codeInputRef.current) {
      codeInputRef.current.focus()
    }
  }, [accountStep])

  // ============================================
  // Account Creation Handlers
  // ============================================

  async function sendCode() {
    setError('')
    setIsLoading(true)

    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to send code')
      }

      setAccountStep('code')
      setResendCooldown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setIsLoading(false)
    }
  }

  async function verifyCode() {
    setError('')
    setIsLoading(true)

    try {
      const result = await authClient.signIn.emailOtp({
        email,
        otp: code,
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to verify code')
      }

      // Sign-in successful - full reload to get new auth state
      // router.refresh() doesn't update client state, so we need a full reload
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code')
    } finally {
      setIsLoading(false)
    }
  }

  // ============================================
  // Workspace Setup Handlers
  // ============================================

  async function handleSetupWorkspace() {
    if (needsName && (!name.trim() || name.trim().length < 2)) {
      setError('Please enter your name')
      return
    }

    if (!wsName.trim() || wsName.trim().length < 2) {
      setError('Workspace name must be at least 2 characters')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await setupWorkspaceAction({
        workspaceName: wsName.trim(),
        userName: needsName ? name.trim() : undefined,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      setCurrentWorkspaceName(result.data.name)
      setStep('create-board')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setIsLoading(false)
    }
  }

  // ============================================
  // Board Creation Handlers
  // ============================================

  async function handleCreateBoard() {
    setIsLoading(true)
    setError('')

    try {
      const result = await createBoardAction({
        name: boardName,
        description: boardDescription,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create board')
    } finally {
      setIsLoading(false)
    }
  }

  // ============================================
  // Step 1: Create Account
  // ============================================

  if (step === 'create-account') {
    return (
      <div className="space-y-8">
        {/* Logo and welcome */}
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/10 rounded-full blur-2xl" />
            <Image src="/logo.png" alt="Quackback" width={72} height={72} className="relative" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Welcome to Quackback</h1>
            <p className="text-muted-foreground">
              Create your admin account to get started.
            </p>
          </div>
        </div>

        {/* Account form */}
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          {/* Email step */}
          {accountStep === 'email' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (email.trim()) sendCode()
              }}
              className="space-y-5"
            >
              {error && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <Button type="submit" disabled={isLoading || !email.trim()} size="lg" className="w-full">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending code...
                  </>
                ) : (
                  'Continue with email'
                )}
              </Button>
            </form>
          )}

          {/* Code step */}
          {accountStep === 'code' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (code.length === 6) verifyCode()
              }}
              className="space-y-5"
            >
              <button
                type="button"
                onClick={() => {
                  setAccountStep('email')
                  setCode('')
                  setError('')
                }}
                className="flex items-center text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </button>

              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-center">
                  We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
                </p>
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="code" className="text-sm font-medium">
                  Verification code
                </label>
                <Input
                  ref={codeInputRef}
                  id="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={isLoading}
                  className="text-center text-2xl tracking-widest"
                  autoComplete="one-time-code"
                />
              </div>

              <Button type="submit" disabled={isLoading || code.length !== 6} size="lg" className="w-full">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify code'
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    if (resendCooldown === 0) {
                      setCode('')
                      sendCode()
                    }
                  }}
                  disabled={resendCooldown > 0 || isLoading}
                  className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : "Didn't receive a code? Resend"}
                </button>
              </div>
            </form>
          )}

        </div>

        {/* Steps preview */}
        <div className="space-y-3 px-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            What we'll do
          </p>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">1</div>
            <span className="text-foreground">Create your admin account</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">2</div>
            <span>Name your workspace</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">3</div>
            <span>Create your first feedback board</span>
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // Step 2: Setup Workspace
  // ============================================

  if (step === 'setup-workspace') {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Welcome, {firstName}!</h1>
            <p className="text-muted-foreground">
              Let's set up your feedback platform.
            </p>
          </div>
        </div>

        {/* Setup form */}
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSetupWorkspace()
            }}
            className="space-y-5"
          >
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {needsName && (
              <div className="space-y-2">
                <label htmlFor="userName" className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Your name
                </label>
                <Input
                  id="userName"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Jane Doe"
                  autoFocus
                  autoComplete="name"
                />
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="workspaceName" className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Workspace name
              </label>
              <Input
                id="workspaceName"
                type="text"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                required
                placeholder="Acme Corp"
                autoFocus={!needsName}
              />
              <p className="text-xs text-muted-foreground">
                Your company or product name
              </p>
            </div>

            <Button type="submit" disabled={isLoading || !wsName.trim() || (needsName && !name.trim())} size="lg" className="w-full group">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </Button>
          </form>
        </div>

        {/* Progress */}
        <div className="space-y-3 px-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Progress
          </p>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs">
              <Check className="h-3 w-3" />
            </div>
            <span className="line-through">Create your admin account</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">2</div>
            <span className="text-foreground">Name your workspace</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">3</div>
            <span>Create your first feedback board</span>
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // Step 3: Create Board
  // ============================================

  if (step === 'create-board') {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Create your first board</h1>
            <p className="text-sm text-muted-foreground">
              A board is where users submit and vote on feedback
            </p>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleCreateBoard()
            }}
            className="space-y-5"
          >
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="boardName" className="text-sm font-medium">
                Board name
              </label>
              <Input
                id="boardName"
                type="text"
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                required
                placeholder="Feature Requests"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="boardDescription" className="text-sm font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Textarea
                id="boardDescription"
                value={boardDescription}
                onChange={(e) => setBoardDescription(e.target.value)}
                rows={3}
                placeholder="Share your ideas and vote on features"
              />
            </div>

            <Button type="submit" disabled={isLoading || !boardName.trim()} size="lg" className="w-full group">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Create board
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </Button>
          </form>
        </div>

        {/* Progress */}
        <div className="space-y-3 px-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Progress
          </p>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs">
              <Check className="h-3 w-3" />
            </div>
            <span className="line-through">Create your admin account</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs">
              <Check className="h-3 w-3" />
            </div>
            <span className="line-through">Name your workspace</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">3</div>
            <span className="text-foreground">Create your first feedback board</span>
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // Step 4: Complete
  // ============================================

  if (step === 'complete') {
    return (
      <div className="space-y-8">
        {/* Success state */}
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/10 rounded-full blur-2xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-8 w-8 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">You're all set!</h1>
            <p className="text-muted-foreground">
              Your feedback board "<span className="font-medium text-foreground">{boardName}</span>"
              is ready.
            </p>
          </div>
        </div>

        {/* Next steps card */}
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm space-y-4">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            What's next
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <LayoutDashboard className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Manage feedback</p>
                <p className="text-xs text-muted-foreground">
                  Review, organize, and respond to submissions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Globe className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Share your portal</p>
                <p className="text-xs text-muted-foreground">
                  Invite users to submit and vote on ideas
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Customize your portal</p>
                <p className="text-xs text-muted-foreground">
                  Add statuses, tags, and roadmap views
                </p>
              </div>
            </div>
          </div>

          <Button onClick={() => router.push('/admin')} size="lg" className="w-full group">
            Go to dashboard
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </div>
      </div>
    )
  }

  return null
}
