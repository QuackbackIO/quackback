import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  BuildingOffice2Icon,
  CheckIcon,
  EnvelopeIcon,
  PlusIcon,
  Squares2X2Icon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createBoardsBatchFn } from '@/lib/server-functions/boards'
import { setupWorkspaceFn } from '@/lib/server-functions/onboarding'
import { authClient } from '@/lib/auth/client'
import { DEFAULT_BOARD_OPTIONS } from './default-boards'

type Step = 'create-account' | 'setup-workspace' | 'choose-boards' | 'complete'

// Initial steps that can be passed from the route
// - create-account: user not authenticated
// - setup-workspace: user authenticated but workspace not configured
// - choose-boards: workspace configured (cloud-provisioned), need to create boards
type InitialStep = 'create-account' | 'setup-workspace' | 'choose-boards'

function CompletionMessage({ boardNames }: { boardNames: string[] }): React.ReactNode {
  if (boardNames.length === 0) {
    return 'You can create feedback boards anytime from Settings'
  }

  if (boardNames.length === 1) {
    return (
      <>
        Your feedback board <span className="font-semibold text-primary">"{boardNames[0]}"</span> is
        ready
      </>
    )
  }

  return <>Your {boardNames.length} feedback boards are ready to collect ideas</>
}

interface OnboardingWizardProps {
  initialStep: InitialStep
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

  // Board selection state (all recommended enabled by default)
  const [selectedBoards, setSelectedBoards] = useState<Set<string>>(
    new Set(DEFAULT_BOARD_OPTIONS.filter((b) => b.isRecommended).map((b) => b.id))
  )
  const [customBoards, setCustomBoards] = useState<Array<{ name: string; description: string }>>([])
  const [newCustomBoard, setNewCustomBoard] = useState({ name: '', description: '' })
  const [showCustomBoardForm, setShowCustomBoardForm] = useState(false)
  const [createdBoardNames, setCreatedBoardNames] = useState<string[]>([])

  // Shared state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const codeInputRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null))
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

      setStep('choose-boards')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setIsLoading(false)
    }
  }

  // ============================================
  // Board Selection Handlers
  // ============================================

  function toggleBoard(boardId: string) {
    setSelectedBoards((prev) => {
      const next = new Set(prev)
      if (next.has(boardId)) {
        next.delete(boardId)
      } else {
        next.add(boardId)
      }
      return next
    })
  }

  function addCustomBoard() {
    const name = newCustomBoard.name.trim()
    const description = newCustomBoard.description.trim()
    if (name) {
      setCustomBoards((prev) => [...prev, { name, description }])
      setNewCustomBoard({ name: '', description: '' })
      setShowCustomBoardForm(false)
    }
  }

  function removeCustomBoard(index: number) {
    setCustomBoards((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleCreateBoards() {
    setIsLoading(true)
    setError('')

    try {
      // Combine default selected boards with custom boards
      const defaultBoardsToCreate = DEFAULT_BOARD_OPTIONS.filter((b) =>
        selectedBoards.has(b.id)
      ).map((b) => ({
        name: b.name,
        description: b.description,
      }))

      const boardsToCreate = [...defaultBoardsToCreate, ...customBoards]

      const created = await createBoardsBatchFn({ data: { boards: boardsToCreate } })
      setCreatedBoardNames(created.map((b) => b.name))
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create boards')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSkipBoards() {
    setIsLoading(true)
    setError('')

    try {
      // Call with empty array to mark boards step as complete in setupState
      await createBoardsBatchFn({ data: { boards: [] } })
      setCreatedBoardNames([])
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete setup')
    } finally {
      setIsLoading(false)
    }
  }

  // ============================================
  // Render
  // ============================================

  return (
    <div className="relative">
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

        {/* Step 3: Choose Boards */}
        {step === 'choose-boards' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Squares2X2Icon className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Set up your boards
                </h1>
                <p className="text-muted-foreground">
                  Boards organize feedback by topic. Toggle the ones you need.
                </p>
              </div>
            </div>

            {/* Board Selection Cards */}
            <Card className="bg-card border border-border/50 shadow-sm">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {error && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  {DEFAULT_BOARD_OPTIONS.map((board) => {
                    const isSelected = selectedBoards.has(board.id)
                    const Icon = board.icon
                    return (
                      <button
                        key={board.id}
                        type="button"
                        onClick={() => toggleBoard(board.id)}
                        disabled={isLoading}
                        className={`
                          w-full flex items-center justify-between gap-4 p-4 rounded-xl
                          border-2 transition-all duration-200 text-left
                          disabled:opacity-50 disabled:cursor-not-allowed
                          ${
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border/50 hover:border-primary/40 hover:bg-muted/30'
                          }
                        `}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Custom checkbox */}
                          <div
                            className={`
                              h-5 w-5 rounded border-2 flex items-center justify-center shrink-0
                              transition-all duration-200
                              ${
                                isSelected
                                  ? 'bg-primary border-primary'
                                  : 'border-muted-foreground/40'
                              }
                            `}
                          >
                            {isSelected && <CheckIcon className="h-3 w-3 text-white" />}
                          </div>

                          {/* Icon */}
                          <div
                            className={`
                              flex h-10 w-10 shrink-0 items-center justify-center rounded-lg
                              transition-colors duration-200
                              ${isSelected ? 'bg-primary/15' : 'bg-muted/50'}
                            `}
                          >
                            <Icon
                              className={`h-5 w-5 transition-colors ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                            />
                          </div>

                          {/* Text */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-foreground">{board.name}</span>
                              {board.isRecommended && (
                                <span className="text-[10px] uppercase tracking-wider font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                  Popular
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {board.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    )
                  })}

                  {/* Custom boards list */}
                  {customBoards.map((board, index) => (
                    <div
                      key={`custom-${index}`}
                      className="w-full flex items-center justify-between gap-4 p-4 rounded-xl border-2 border-primary bg-primary/5 shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 bg-primary border-primary">
                          <CheckIcon className="h-3 w-3 text-white" />
                        </div>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                          <Squares2X2Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-foreground">{board.name}</span>
                          {board.description && (
                            <p className="text-sm text-muted-foreground truncate">
                              {board.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCustomBoard(index)}
                        disabled={isLoading}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        aria-label="Remove board"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}

                  {/* Add custom board form */}
                  {showCustomBoardForm ? (
                    <div className="p-4 rounded-xl border-2 border-dashed border-border space-y-3">
                      <Input
                        type="text"
                        value={newCustomBoard.name}
                        onChange={(e) =>
                          setNewCustomBoard((prev) => ({ ...prev, name: e.target.value }))
                        }
                        placeholder="Board name"
                        autoFocus
                        disabled={isLoading}
                      />
                      <Input
                        type="text"
                        value={newCustomBoard.description}
                        onChange={(e) =>
                          setNewCustomBoard((prev) => ({ ...prev, description: e.target.value }))
                        }
                        placeholder="Description (optional)"
                        disabled={isLoading}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowCustomBoardForm(false)
                            setNewCustomBoard({ name: '', description: '' })
                          }}
                          disabled={isLoading}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={addCustomBoard}
                          disabled={isLoading || !newCustomBoard.name.trim()}
                        >
                          Add board
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCustomBoardForm(true)}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <PlusIcon className="h-5 w-5" />
                      <span>Add custom board</span>
                    </button>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 mt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleSkipBoards}
                    disabled={isLoading}
                    className="flex-1"
                  >
                    Skip for now
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCreateBoards}
                    disabled={isLoading}
                    className="flex-1 bg-primary hover:bg-primary/90 text-white"
                  >
                    {isLoading ? (
                      <>
                        <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        {(() => {
                          const totalBoards = selectedBoards.size + customBoards.length
                          return totalBoards === 0
                            ? 'Continue'
                            : `Create ${totalBoards} board${totalBoards !== 1 ? 's' : ''}`
                        })()}
                        <ArrowRightIcon className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
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
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckIcon className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Setup complete
                </h1>
                <p className="text-muted-foreground">
                  <CompletionMessage boardNames={createdBoardNames} />
                </p>
              </div>
            </div>

            <Button
              onClick={() => router.navigate({ to: '/admin' as any })}
              className="w-full bg-primary hover:bg-primary text-white"
            >
              Go to dashboard
              <ArrowRightIcon className="ml-2 h-4 w-4" />
            </Button>

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
