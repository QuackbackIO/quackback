import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  BuildingOffice2Icon,
  ChatBubbleLeftIcon,
  CheckIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  RocketLaunchIcon,
  SparklesIcon,
  Squares2X2Icon,
  UserIcon,
} from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createBoardFn } from '@/lib/server-functions/boards'
import { setupWorkspaceFn } from '@/lib/server-functions/onboarding'
import { authClient } from '@/lib/auth/client'

type Step = 'create-account' | 'setup-workspace' | 'create-board' | 'complete'

interface OnboardingWizardProps {
  initialStep: Step
  userName?: string | null
}

export function OnboardingWizard({ initialStep, userName }: OnboardingWizardProps) {
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
  const [showConfetti, setShowConfetti] = useState(false)

  const codeInputRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const autoSubmittedCodeRef = useRef<string>('')

  const firstName = userName?.split(' ')[0] || name.split(' ')[0] || 'there'
  const needsName = !userName

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  // Focus first code input when step changes
  useEffect(() => {
    if (accountStep === 'code' && codeInputRefs.current[0]) {
      codeInputRefs.current[0].focus()
    }
  }, [accountStep])

  // Confetti animation
  useEffect(() => {
    if (showConfetti && canvasRef.current) {
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      canvas.width = window.innerWidth
      canvas.height = window.innerHeight

      const particles: Array<{
        x: number
        y: number
        vx: number
        vy: number
        color: string
        size: number
        rotation: number
        rotationSpeed: number
      }> = []

      const colors = ['#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#facc15']

      // Create particles
      for (let i = 0; i < 150; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: -10 - Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 4,
          vy: Math.random() * 3 + 2,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: Math.random() * 8 + 4,
          rotation: Math.random() * 360,
          rotationSpeed: (Math.random() - 0.5) * 10,
        })
      }

      let animationFrame: number

      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        particles.forEach((p) => {
          p.y += p.vy
          p.x += p.vx
          p.rotation += p.rotationSpeed
          p.vy += 0.1 // gravity

          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate((p.rotation * Math.PI) / 180)
          ctx.fillStyle = p.color
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size / 2)
          ctx.restore()
        })

        if (particles.every((p) => p.y > canvas.height)) {
          setShowConfetti(false)
        } else {
          animationFrame = requestAnimationFrame(animate)
        }
      }

      animate()

      return () => {
        if (animationFrame) cancelAnimationFrame(animationFrame)
      }
    }
  }, [showConfetti])

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

  const verifyCode = useCallback(
    async (otpCode: string) => {
      setError('')
      setIsLoading(true)

      try {
        const result = await authClient.signIn.emailOtp({
          email,
          otp: otpCode,
        })

        if (result.error) {
          throw new Error(result.error.message || 'Failed to verify code')
        }

        // Sign-in successful - redirect to onboarding to continue setup
        window.location.href = '/onboarding'
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to verify code')
        // Clear auto-submit tracker on error so user can retry
        autoSubmittedCodeRef.current = ''
      } finally {
        setIsLoading(false)
      }
    },
    [email]
  )

  // Auto-submit when OTP is complete (but only once per code)
  useEffect(() => {
    if (code.length === 6 && code !== autoSubmittedCodeRef.current && !isLoading) {
      autoSubmittedCodeRef.current = code
      verifyCode(code)
    }
    // Reset the auto-submit tracker when code is cleared or changed to non-complete
    if (code.length < 6) {
      autoSubmittedCodeRef.current = ''
    }
  }, [code, isLoading, verifyCode])

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
      await setupWorkspaceFn({
        data: {
          workspaceName: wsName.trim(),
          userName: needsName ? name.trim() : undefined,
        },
      })

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
      await createBoardFn({
        data: {
          name: boardName,
          description: boardDescription,
        },
      })

      setStep('complete')
      setShowConfetti(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create board')
    } finally {
      setIsLoading(false)
    }
  }

  // ============================================
  // Render
  // ============================================

  return (
    <div className="relative">
      {/* Confetti Canvas */}
      {showConfetti && (
        <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-50" />
      )}

      {/* Step Content */}
      <div className="relative">
        {/* Step 1: Create Account */}
        {step === 'create-account' && (
          <div className="space-y-6">
            {/* Logo and welcome */}
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="relative">
                <img src="/logo.png" alt="Quackback" width={64} height={64} />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Welcome to Quackback
                </h1>
                <p className="text-muted-foreground">Create your admin account to get started</p>
              </div>
            </div>

            {/* Form Card */}
            <Card className="bg-card border border-border/50 shadow-sm">
              <CardContent className="pt-6">
                {/* Email step */}
                {accountStep === 'email' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (email.trim()) sendCode()
                    }}
                    className="space-y-4"
                  >
                    {error && (
                      <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                        {error}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label
                        htmlFor="email"
                        className="text-sm font-medium flex items-center gap-2"
                      >
                        <EnvelopeIcon className="h-4 w-4 text-primary" />
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

                    <Button
                      type="submit"
                      disabled={isLoading || !email.trim()}
                      className="w-full bg-primary hover:bg-primary text-white"
                    >
                      {isLoading ? (
                        <>
                          <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                          Sending code...
                        </>
                      ) : (
                        <>
                          Continue with email
                          <ArrowRightIcon className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                )}

                {/* Code step */}
                {accountStep === 'code' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (code.length === 6) verifyCode(code)
                    }}
                    className="space-y-4"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAccountStep('email')
                        setCode('')
                        setError('')
                        autoSubmittedCodeRef.current = ''
                      }}
                      className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeftIcon className="mr-2 h-4 w-4" />
                      Back to email
                    </button>

                    <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 text-center">
                      <p className="text-sm text-muted-foreground">We sent a 6-digit code to</p>
                      <p className="font-medium text-primary mt-1">{email}</p>
                    </div>

                    {error && (
                      <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                        {error}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-center block">
                        Verification code
                      </label>
                      {/* OTP Input Boxes */}
                      <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2">
                        {[0, 1, 2, 3, 4, 5].map((index) => (
                          <input
                            key={index}
                            ref={(el) => {
                              codeInputRefs.current[index] = el
                            }}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={1}
                            value={code[index] || ''}
                            disabled={isLoading}
                            onChange={(e) => {
                              const value = e.target.value.replace(/\D/g, '')
                              if (value.length <= 1) {
                                const newCode = code.split('')
                                newCode[index] = value
                                const updatedCode = newCode.join('').slice(0, 6)
                                setCode(updatedCode)

                                // Auto-focus next input
                                if (value && index < 5) {
                                  codeInputRefs.current[index + 1]?.focus()
                                }
                              }
                            }}
                            onKeyDown={(e) => {
                              // Handle backspace
                              if (e.key === 'Backspace') {
                                e.preventDefault()
                                const newCode = code.split('')

                                if (code[index]) {
                                  // Clear current box
                                  newCode[index] = ''
                                  setCode(newCode.join(''))
                                } else if (index > 0) {
                                  // Move to previous box and clear it
                                  newCode[index - 1] = ''
                                  setCode(newCode.join(''))
                                  codeInputRefs.current[index - 1]?.focus()
                                }
                              }

                              // Handle left/right arrow keys
                              if (e.key === 'ArrowLeft' && index > 0) {
                                e.preventDefault()
                                codeInputRefs.current[index - 1]?.focus()
                              }
                              if (e.key === 'ArrowRight' && index < 5) {
                                e.preventDefault()
                                codeInputRefs.current[index + 1]?.focus()
                              }
                            }}
                            onPaste={(e) => {
                              e.preventDefault()
                              const pastedData = e.clipboardData
                                .getData('text')
                                .replace(/\D/g, '')
                                .slice(0, 6)
                              if (pastedData) {
                                setCode(pastedData)
                                // Focus the last filled box or the next empty one
                                const focusIndex = Math.min(pastedData.length, 5)
                                codeInputRefs.current[focusIndex]?.focus()
                              }
                            }}
                            onFocus={(e) => {
                              e.target.select()
                            }}
                            className={`
                              h-14 w-12 sm:h-16 sm:w-14
                              text-center text-2xl font-mono font-semibold
                              rounded-lg
                              border-2 transition-colors
                              ${
                                code[index]
                                  ? 'border-primary bg-primary/5 text-foreground'
                                  : 'border-border bg-background text-muted-foreground'
                              }
                              focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
                              disabled:opacity-50 disabled:cursor-not-allowed
                              hover:border-primary/50
                            `}
                            aria-label={`Digit ${index + 1}`}
                            autoComplete={index === 0 ? 'one-time-code' : 'off'}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground text-center">
                        Enter the 6-digit code • Auto-submits when complete
                      </p>
                    </div>

                    {code.length === 6 && isLoading && (
                      <div className="flex items-center justify-center gap-2 text-primary py-2">
                        <ArrowPathIcon className="h-4 w-4 animate-spin" />
                        <span className="text-sm font-medium">Verifying...</span>
                      </div>
                    )}

                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => {
                          if (resendCooldown === 0) {
                            setCode('')
                            setError('')
                            autoSubmittedCodeRef.current = ''
                            sendCode()
                          }
                        }}
                        disabled={resendCooldown > 0 || isLoading}
                        className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {resendCooldown > 0
                          ? `Resend code in ${resendCooldown}s`
                          : "Didn't receive it? Resend code"}
                      </button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            {/* Mini Progress Indicator */}
            <div className="flex items-center justify-center gap-2">
              <div className="h-1.5 w-8 rounded-full bg-primary" />
              <div className="h-1.5 w-8 rounded-full bg-muted" />
              <div className="h-1.5 w-8 rounded-full bg-muted" />
            </div>
          </div>
        )}

        {/* Step 2: Setup Workspace */}
        {step === 'setup-workspace' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <BuildingOffice2Icon className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Welcome, {firstName}!
                </h1>
                <p className="text-muted-foreground">Let's set up your feedback platform</p>
              </div>
            </div>

            {/* Form */}
            <Card className="bg-card border border-border/50 shadow-sm">
              <CardContent className="pt-6">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSetupWorkspace()
                  }}
                  className="space-y-4"
                >
                  {error && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  {needsName && (
                    <div className="space-y-2">
                      <label
                        htmlFor="userName"
                        className="text-sm font-medium flex items-center gap-2"
                      >
                        <UserIcon className="h-4 w-4 text-primary" />
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
                    <label
                      htmlFor="workspaceName"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <BuildingOffice2Icon className="h-4 w-4 text-primary" />
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
                    <p className="text-xs text-muted-foreground">Your company or product name</p>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading || !wsName.trim() || (needsName && !name.trim())}
                    className="w-full bg-primary hover:bg-primary text-white"
                  >
                    {isLoading ? (
                      <>
                        <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                        Creating workspace...
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowRightIcon className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Mini Progress Indicator */}
            <div className="flex items-center justify-center gap-2">
              <div className="h-1.5 w-8 rounded-full bg-primary/40" />
              <div className="h-1.5 w-8 rounded-full bg-primary" />
              <div className="h-1.5 w-8 rounded-full bg-muted" />
            </div>
          </div>
        )}

        {/* Step 3: Create Board */}
        {step === 'create-board' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <ChatBubbleLeftIcon className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Create your first board
                </h1>
                <p className="text-muted-foreground">Where users submit and vote on feedback</p>
              </div>
            </div>

            {/* Form */}
            <Card className="bg-card border border-border/50 shadow-sm">
              <CardContent className="pt-6">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleCreateBoard()
                  }}
                  className="space-y-4"
                >
                  {error && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
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
                      Description{' '}
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </label>
                    <Textarea
                      id="boardDescription"
                      value={boardDescription}
                      onChange={(e) => setBoardDescription(e.target.value)}
                      rows={3}
                      placeholder="Share your ideas and vote on features"
                      className="resize-none"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading || !boardName.trim()}
                    className="w-full bg-primary hover:bg-primary text-white"
                  >
                    {isLoading ? (
                      <>
                        <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                        Creating board...
                      </>
                    ) : (
                      <>
                        Create board
                        <RocketLaunchIcon className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Mini Progress Indicator */}
            <div className="flex items-center justify-center gap-2">
              <div className="h-1.5 w-8 rounded-full bg-primary/40" />
              <div className="h-1.5 w-8 rounded-full bg-primary/40" />
              <div className="h-1.5 w-8 rounded-full bg-primary" />
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 'complete' && (
          <div className="space-y-6">
            {/* Success state */}
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary shadow-sm">
                <CheckIcon className="h-8 w-8 text-white" />
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-bold tracking-tight text-foreground">
                  You're all set!
                </h1>
                <p className="text-muted-foreground">
                  Your feedback board{' '}
                  <span className="font-semibold text-primary">"{boardName}"</span> is ready
                </p>
              </div>
            </div>

            {/* Next steps card */}
            <Card className="bg-card border border-border/50 shadow-sm">
              <CardContent className="pt-6 space-y-4">
                <p className="text-sm font-semibold text-primary uppercase tracking-wider">
                  What's next
                </p>

                <div className="space-y-3">
                  {[
                    {
                      icon: Squares2X2Icon,
                      title: 'Manage feedback',
                      desc: 'Review, organize, and respond to submissions',
                    },
                    {
                      icon: GlobeAltIcon,
                      title: 'Share your portal',
                      desc: 'Invite users to submit and vote on ideas',
                    },
                    {
                      icon: SparklesIcon,
                      title: 'Customize your portal',
                      desc: 'Add statuses, tags, and roadmap views',
                    },
                  ].map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/30 hover:bg-muted/50 hover:border-primary/20 transition-colors"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <item.icon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={() => router.navigate({ to: '/admin' as any })}
                  className="w-full bg-primary hover:bg-primary text-white"
                >
                  Go to dashboard
                  <ArrowRightIcon className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Mini Progress Indicator */}
            <div className="flex items-center justify-center gap-2">
              <div className="h-1.5 w-8 rounded-full bg-primary/40" />
              <div className="h-1.5 w-8 rounded-full bg-primary/40" />
              <div className="h-1.5 w-8 rounded-full bg-primary" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
