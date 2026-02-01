import { useState, useEffect, useRef, useCallback } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/server/auth/client'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { saveUserNameFn } from '@/lib/server/functions/onboarding'

export const Route = createFileRoute('/onboarding/_layout/account')({
  loader: async ({ context }) => {
    const { session } = context

    if (session?.user) {
      const state = await checkOnboardingState({ data: session.user.id })

      if (state.needsInvitation) {
        throw redirect({ to: '/auth/login' })
      }

      if (state.setupState?.steps?.workspace) {
        throw redirect({ to: '/onboarding/boards' })
      }

      // If use case is selected, go to workspace; otherwise go to use case selection
      if (state.setupState?.useCase) {
        throw redirect({ to: '/onboarding/workspace' })
      }

      throw redirect({ to: '/onboarding/usecase' })
    }

    return {}
  },
  component: AccountStep,
})

function AccountStep() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'details' | 'code'>('details')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const codeInputRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null))
  const autoSubmittedCodeRef = useRef<string>('')
  const pendingNameRef = useRef<string>('')

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  useEffect(() => {
    if (step === 'code' && codeInputRefs.current[0]) {
      codeInputRefs.current[0].focus()
    }
  }, [step])

  async function sendCode() {
    if (!name.trim() || name.trim().length < 2) {
      setError('Please enter your name')
      return
    }

    if (!email.trim()) {
      setError('Please enter your email')
      return
    }

    setError('')
    setIsLoading(true)
    pendingNameRef.current = name.trim()

    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to send code')
      }

      setStep('code')
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

        // Save the name that was entered before verification
        if (pendingNameRef.current) {
          await saveUserNameFn({ data: { name: pendingNameRef.current } })
        }

        window.location.href = '/onboarding/usecase'
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to verify code')
        autoSubmittedCodeRef.current = ''
      } finally {
        setIsLoading(false)
      }
    },
    [email]
  )

  useEffect(() => {
    if (code.length === 6 && code !== autoSubmittedCodeRef.current && !isLoading) {
      autoSubmittedCodeRef.current = code
      verifyCode(code)
    }
    if (code.length < 6) {
      autoSubmittedCodeRef.current = ''
    }
  }, [code, isLoading, verifyCode])

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Main card */}
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card/90 to-card/70 backdrop-blur-sm">
        <div className="p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold">
              {step === 'details' && 'Welcome to Quackback'}
              {step === 'code' && 'Check your email'}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {step === 'details' && 'Create your account to get started'}
              {step === 'code' && (
                <>
                  We sent a code to <span className="text-foreground font-medium">{email}</span>
                </>
              )}
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {step === 'details' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendCode()
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Your name
                </label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Jane Doe"
                  autoComplete="name"
                  autoFocus
                  disabled={isLoading}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
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
                  disabled={isLoading}
                  className="h-11"
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading || !email.trim() || !name.trim()}
                className="w-full h-11"
              >
                {isLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Continue'}
              </Button>
            </form>
          )}

          {step === 'code' && (
            <div className="space-y-6">
              {/* OTP Input */}
              <div className="space-y-3">
                <label className="text-sm font-medium block text-center">
                  Enter verification code
                </label>
                <div className="flex justify-center gap-2">
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

                          if (value && index < 5) {
                            codeInputRefs.current[index + 1]?.focus()
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace') {
                          e.preventDefault()
                          const newCode = code.split('')

                          if (code[index]) {
                            newCode[index] = ''
                            setCode(newCode.join(''))
                          } else if (index > 0) {
                            newCode[index - 1] = ''
                            setCode(newCode.join(''))
                            codeInputRefs.current[index - 1]?.focus()
                          }
                        }

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
                          const focusIndex = Math.min(pastedData.length, 5)
                          codeInputRefs.current[focusIndex]?.focus()
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                      className={`
                        h-12 w-10 text-center text-lg font-semibold rounded-lg
                        border transition-all duration-200
                        bg-background
                        ${
                          code[index]
                            ? 'border-primary'
                            : 'border-border hover:border-muted-foreground/50'
                        }
                        focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                      aria-label={`Digit ${index + 1}`}
                      autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    />
                  ))}
                </div>
              </div>

              {code.length === 6 && isLoading && (
                <div className="flex items-center justify-center gap-2 text-primary">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span className="text-sm font-medium">Verifying...</span>
                </div>
              )}

              <Button
                type="button"
                disabled={isLoading || code.length !== 6}
                onClick={() => verifyCode(code)}
                className="w-full h-11"
              >
                {isLoading && code.length === 6 ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  'Verify'
                )}
              </Button>

              <div className="flex items-center justify-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setStep('details')
                    setCode('')
                    setError('')
                    autoSubmittedCodeRef.current = ''
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Change email
                </button>
                <span className="text-border">|</span>
                {resendCooldown > 0 ? (
                  <span className="text-muted-foreground">Resend in {resendCooldown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCode('')
                      setError('')
                      autoSubmittedCodeRef.current = ''
                      sendCode()
                    }}
                    disabled={isLoading}
                    className="text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50"
                  >
                    Resend code
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
