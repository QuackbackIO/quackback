'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2, Mail, ArrowRight, Building2, ArrowLeft, CheckCircle2 } from 'lucide-react'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface EmailFormData {
  email: string
}

interface CodeFormData {
  code: string
}

interface Workspace {
  id: string
  name: string
  slug: string
  domain: string
  logoUrl: string | null
  role: string
}

type Step = 'email' | 'code' | 'workspaces'

/**
 * Sign In Form - Multi-step workspace finder
 *
 * Step 1: Enter email
 * Step 2: Enter verification code
 * Step 3: Select workspace
 */
export function SigninForm() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [verifiedEmailToken, setVerifiedEmailToken] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null)

  const emailForm = useForm<EmailFormData>({
    defaultValues: { email: '' },
  })

  const codeForm = useForm<CodeFormData>({
    defaultValues: { code: '' },
  })

  // Step 1: Send verification code
  async function onEmailSubmit(data: EmailFormData) {
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/signin-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send code')
      }

      setEmail(data.email)
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  // Step 2: Verify code and get workspaces
  async function onCodeSubmit(data: CodeFormData) {
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/verify-signin-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: data.code }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Invalid code')
      }

      setWorkspaces(result.workspaces)
      setVerifiedEmailToken(result.verifiedEmailToken)
      setStep('workspaces')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  // Step 3: Select workspace and redirect
  async function selectWorkspace(workspace: Workspace) {
    setError('')
    setRedirectingTo(workspace.slug)

    try {
      const response = await fetch('/api/auth/workspace-redirect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifiedEmailToken,
          workspaceId: workspace.id,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to sign in')
      }

      // Redirect to workspace with session transfer token
      window.location.href = result.redirectUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setRedirectingTo(null)
    }
  }

  // Go back to email step
  function goBack() {
    setStep('email')
    setEmail('')
    setWorkspaces([])
    setVerifiedEmailToken('')
    setError('')
    codeForm.reset()
  }

  // Resend code
  async function resendCode() {
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/signin-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to resend code')
      }

      // Show success briefly
      setError('') // Clear any existing error
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  // Step 1: Email input
  if (step === 'email') {
    return (
      <Form {...emailForm}>
        <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <FormField
            control={emailForm.control}
            name="email"
            rules={{
              required: 'Email is required',
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: 'Please enter a valid email',
              },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email address</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      className="pl-10"
                      autoFocus
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending code...
              </>
            ) : (
              <>
                Continue with email
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </Form>
    )
  }

  // Step 2: Code verification
  if (step === 'code') {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            We sent a code to <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>

        <Form {...codeForm}>
          <form onSubmit={codeForm.handleSubmit(onCodeSubmit)} className="space-y-4">
            <FormField
              control={codeForm.control}
              name="code"
              rules={{
                required: 'Code is required',
                minLength: { value: 6, message: 'Code must be 6 digits' },
                maxLength: { value: 6, message: 'Code must be 6 digits' },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Verification code</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="000000"
                      className="text-center text-2xl tracking-[0.5em] font-mono"
                      maxLength={6}
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify code'
              )}
            </Button>
          </form>
        </Form>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Change email
          </button>
          <button
            type="button"
            onClick={resendCode}
            disabled={isLoading}
            className="text-primary hover:underline disabled:opacity-50"
          >
            Resend code
          </button>
        </div>
      </div>
    )
  }

  // Step 3: Workspace selection
  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {workspaces.length === 0
            ? 'No workspaces found for this email'
            : workspaces.length === 1
              ? 'Found 1 workspace'
              : `Found ${workspaces.length} workspaces`}
        </p>
      </div>

      {workspaces.length === 0 ? (
        <div className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            You don&apos;t have any workspaces yet. Create one to get started!
          </p>
          <Button asChild className="w-full">
            <a href="/create-workspace">
              Create a workspace
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              onClick={() => selectWorkspace(workspace)}
              disabled={redirectingTo !== null}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                {workspace.logoUrl ? (
                  <img
                    src={workspace.logoUrl}
                    alt={workspace.name}
                    className="h-10 w-10 rounded-lg object-cover"
                  />
                ) : (
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{workspace.name}</p>
                <p className="text-xs text-muted-foreground truncate">{workspace.domain}</p>
              </div>
              {redirectingTo === workspace.slug ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={goBack}
        className="w-full flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Try a different email
      </button>
    </div>
  )
}
