'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ArrowPathIcon,
  EnvelopeIcon,
  ArrowLeftIcon,
  CheckIcon,
  ExclamationCircleIcon,
  BuildingOffice2Icon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'
import {
  sendVerificationCode,
  verifyCode,
  checkSlugAvailability,
  createWorkspaceFn,
} from '@/lib/server-functions/get-started'

export const Route = createFileRoute('/get-started')({
  component: GetStartedPage,
})

type Step = 'email' | 'code' | 'workspace' | 'processing'

interface ProvisioningStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'complete' | 'error'
}

function ProvisioningStepIcon({ status }: { status: ProvisioningStep['status'] }): React.ReactNode {
  switch (status) {
    case 'pending':
      return <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
    case 'active':
      return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-primary" />
    case 'complete':
      return <CheckIcon className="h-3.5 w-3.5 text-white" />
    case 'error':
      return <ExclamationCircleIcon className="h-3.5 w-3.5 text-white" />
  }
}

function GetStartedPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [slugError, setSlugError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [checkingSlug, setCheckingSlug] = useState(false)

  const [provisioningSteps, setProvisioningSteps] = useState<ProvisioningStep[]>([
    { id: 'database', label: 'Creating database', status: 'pending' },
    { id: 'migrations', label: 'Running migrations', status: 'pending' },
    { id: 'workspace', label: 'Setting up workspace', status: 'pending' },
    { id: 'account', label: 'Creating your account', status: 'pending' },
  ])

  const codeInputRef = useRef<HTMLInputElement>(null)
  const slugCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  // Focus code input when step changes
  useEffect(() => {
    if (step === 'code') {
      codeInputRef.current?.focus()
    }
  }, [step])

  // Generate slug from workspace name
  useEffect(() => {
    if (workspaceName && !slug) {
      const generatedSlug = workspaceName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
      setSlug(generatedSlug)
    }
  }, [workspaceName, slug])

  // Check slug availability with debounce
  const checkSlug = useCallback(async (slugValue: string) => {
    if (slugValue.length < 3) {
      setSlugAvailable(null)
      setSlugError('Slug must be at least 3 characters')
      return
    }

    setCheckingSlug(true)
    setSlugError('')

    try {
      const result = await checkSlugAvailability({ data: { slug: slugValue } })
      setSlugAvailable(result.available)
      if (!result.available) {
        setSlugError(result.reason || 'This URL is already taken')
      }
    } catch {
      setSlugError('Failed to check availability')
    } finally {
      setCheckingSlug(false)
    }
  }, [])

  useEffect(() => {
    if (slugCheckTimeoutRef.current) {
      clearTimeout(slugCheckTimeoutRef.current)
    }

    if (slug.length >= 3) {
      slugCheckTimeoutRef.current = setTimeout(() => {
        checkSlug(slug)
      }, 300)
    } else {
      setSlugAvailable(null)
    }

    return () => {
      if (slugCheckTimeoutRef.current) {
        clearTimeout(slugCheckTimeoutRef.current)
      }
    }
  }, [slug, checkSlug])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await sendVerificationCode({ data: { email } })
      setStep('code')
      setResendCooldown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await verifyCode({ data: { email, code } })
      setVerificationToken(result.token)
      setStep('workspace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code')
    } finally {
      setLoading(false)
    }
  }

  const handleResendCode = async () => {
    if (resendCooldown > 0) return

    setError('')
    setLoading(true)

    try {
      await sendVerificationCode({ data: { email } })
      setResendCooldown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code')
    } finally {
      setLoading(false)
    }
  }

  const updateProvisioningStep = (stepId: string, status: ProvisioningStep['status']) => {
    setProvisioningSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status } : s)))
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!slugAvailable) return

    setError('')
    setStep('processing')

    // Simulate progress updates
    updateProvisioningStep('database', 'active')

    try {
      // Start workspace creation (this is the long-running operation)
      const resultPromise = createWorkspaceFn({
        data: {
          email,
          name: workspaceName,
          slug,
          verificationToken,
        },
      })

      // Update UI with simulated progress while waiting
      setTimeout(() => {
        updateProvisioningStep('database', 'complete')
        updateProvisioningStep('migrations', 'active')
      }, 2000)

      setTimeout(() => {
        updateProvisioningStep('migrations', 'complete')
        updateProvisioningStep('workspace', 'active')
      }, 5000)

      setTimeout(() => {
        updateProvisioningStep('workspace', 'complete')
        updateProvisioningStep('account', 'active')
      }, 8000)

      const result = await resultPromise

      // Mark all steps complete
      setProvisioningSteps((prev) => prev.map((s) => ({ ...s, status: 'complete' as const })))

      // Short delay then redirect
      await new Promise((r) => setTimeout(r, 500))
      window.location.href = result.redirectUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      // Mark current step as error
      setProvisioningSteps((prev) =>
        prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' as const } : s))
      )
      setStep('workspace')
    }
  }

  const handleBack = () => {
    setError('')
    if (step === 'code') {
      setStep('email')
      setCode('')
    } else if (step === 'workspace') {
      setStep('code')
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-8">
          {/* Logo/Brand */}
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <BuildingOffice2Icon className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">
              {step === 'email' && 'Get Started'}
              {step === 'code' && 'Check your email'}
              {step === 'workspace' && 'Create your workspace'}
              {step === 'processing' && 'Setting up...'}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {step === 'email' && 'Enter your email to create a new workspace'}
              {step === 'code' && `We sent a 6-digit code to ${email}`}
              {step === 'workspace' && 'Choose a name and URL for your workspace'}
              {step === 'processing' && 'This will only take a moment'}
            </p>
          </div>

          {/* Error alert */}
          {error && (
            <Alert variant="destructive">
              <ExclamationCircleIcon className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Step 1: Email */}
          {step === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email address
                </label>
                <div className="relative">
                  <EnvelopeIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading || !email}>
                {loading ? (
                  <>
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    Sending code...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </form>
          )}

          {/* Step 2: Verification Code */}
          {step === 'code' && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
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
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  required
                  disabled={loading}
                  autoComplete="one-time-code"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading ? (
                  <>
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify code'
                )}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendCooldown > 0 || loading}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Workspace Details */}
          {step === 'workspace' && (
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Workspace name
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Acme Corp"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="slug" className="text-sm font-medium">
                  Workspace URL
                </label>
                <div className="flex items-center gap-0">
                  <span className="flex h-9 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                    https://
                  </span>
                  <Input
                    id="slug"
                    type="text"
                    placeholder="acme"
                    value={slug}
                    onChange={(e) =>
                      setSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, '')
                          .slice(0, 32)
                      )
                    }
                    className="rounded-l-none rounded-r-none border-r-0"
                    required
                    disabled={loading}
                  />
                  <span className="flex h-9 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                    .quackback.io
                  </span>
                </div>
                {/* Availability indicator */}
                <div className="flex items-center gap-2 text-sm">
                  {checkingSlug && (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">Checking availability...</span>
                    </>
                  )}
                  {!checkingSlug && slugAvailable === true && slug.length >= 3 && (
                    <>
                      <CheckIcon className="h-4 w-4 text-green-600" />
                      <span className="text-green-600">{slug}.quackback.io is available</span>
                    </>
                  )}
                  {!checkingSlug && slugAvailable === false && (
                    <>
                      <ExclamationCircleIcon className="h-4 w-4 text-destructive" />
                      <span className="text-destructive">{slugError}</span>
                    </>
                  )}
                  {!checkingSlug && slug.length > 0 && slug.length < 3 && (
                    <span className="text-muted-foreground">{slugError}</span>
                  )}
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !workspaceName || !slug || !slugAvailable}
              >
                Create workspace
              </Button>

              <button
                type="button"
                onClick={handleBack}
                className="flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back
              </button>
            </form>
          )}

          {/* Step 4: Processing */}
          {step === 'processing' && (
            <div className="space-y-6">
              <div className="space-y-3">
                {provisioningSteps.map((pStep) => (
                  <div key={pStep.id} className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border-2',
                        pStep.status === 'pending' && 'border-muted-foreground/30',
                        pStep.status === 'active' && 'border-primary',
                        pStep.status === 'complete' && 'border-green-600 bg-green-600',
                        pStep.status === 'error' && 'border-destructive bg-destructive'
                      )}
                    >
                      <ProvisioningStepIcon status={pStep.status} />
                    </div>
                    <span
                      className={cn(
                        'text-sm',
                        pStep.status === 'pending' && 'text-muted-foreground',
                        pStep.status === 'active' && 'text-foreground font-medium',
                        pStep.status === 'complete' && 'text-green-600',
                        pStep.status === 'error' && 'text-destructive'
                      )}
                    >
                      {pStep.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
