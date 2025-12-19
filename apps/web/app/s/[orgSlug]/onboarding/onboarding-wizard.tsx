'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Check,
  MessageSquare,
  Share2,
  ArrowRight,
  ArrowLeft,
  LayoutDashboard,
  Globe,
  Sparkles,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createBoardAction } from '@/lib/actions/boards'
import type { WorkspaceId } from '@quackback/ids'

interface OnboardingWizardProps {
  workspaceName: string
  workspaceId: string
  userName: string
}

type Step = 'welcome' | 'create-board' | 'complete'

export function OnboardingWizard({ workspaceName, workspaceId, userName }: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('welcome')
  const [boardName, setBoardName] = useState('')
  const [boardDescription, setBoardDescription] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const firstName = userName.split(' ')[0]

  async function handleCreateBoard() {
    setIsLoading(true)
    setError('')

    try {
      const result = await createBoardAction({
        name: boardName,
        description: boardDescription,
        workspaceId: workspaceId as WorkspaceId,
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

  if (step === 'welcome') {
    return (
      <div className="space-y-8">
        {/* Logo and welcome */}
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/10 rounded-full blur-2xl" />
            <Image src="/logo.png" alt="Quackback" width={72} height={72} className="relative" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Welcome, {firstName}!</h1>
            <p className="text-muted-foreground">
              Let's set up <span className="font-semibold text-foreground">{workspaceName}</span> to
              start collecting feedback.
            </p>
          </div>
        </div>

        {/* Steps card */}
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm space-y-4">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Here's what we'll do
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Create your first feedback board</p>
                <p className="text-xs text-muted-foreground">
                  A place for users to submit and vote on ideas
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Share2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Share with your users</p>
                <p className="text-xs text-muted-foreground">
                  Get your public board link or embed the widget
                </p>
              </div>
            </div>
          </div>

          <Button onClick={() => setStep('create-board')} size="lg" className="w-full group">
            Get started
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </div>
      </div>
    )
  }

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
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="boardDescription" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="boardDescription"
                value={boardDescription}
                onChange={(e) => setBoardDescription(e.target.value)}
                rows={3}
                placeholder="Share your ideas and vote on features"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('welcome')}
                className="flex-1"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button type="submit" disabled={isLoading || !boardName.trim()} className="flex-1">
                {isLoading ? 'Creating...' : 'Create board'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    )
  }

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
