'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MessageSquare, Sparkles, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface OnboardingWizardProps {
  organizationName: string
  organizationId: string
  userName: string
}

type Step = 'welcome' | 'create-board' | 'complete'

export function OnboardingWizard({ organizationName, organizationId, userName }: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('welcome')
  const [boardName, setBoardName] = useState('Feature Requests')
  const [boardDescription, setBoardDescription] = useState('Share your ideas and vote on features you want to see')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const firstName = userName.split(' ')[0]

  async function handleCreateBoard() {
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: boardName,
          description: boardDescription,
          organizationId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create board')
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
      <div className="space-y-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80">
          <Sparkles className="h-8 w-8 text-primary-foreground" />
        </div>

        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Welcome, {firstName}!
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Let's set up <span className="font-semibold">{organizationName}</span> to start collecting feedback from your users.
          </p>
        </div>

        <div className="space-y-4 text-left">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Here's what we'll do:
          </h2>
          <div className="space-y-3">
            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  1
                </div>
                <div>
                  <p className="font-medium text-foreground">Create your first feedback board</p>
                  <p className="text-sm text-muted-foreground">A place for users to submit and vote on ideas</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  2
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Share with your users</p>
                  <p className="text-sm text-muted-foreground">Get your public board link or embed the widget</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Button onClick={() => setStep('create-board')} size="lg">
          Get started
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  if (step === 'create-board') {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-foreground">
            Create your first board
          </h1>
          <p className="mt-2 text-muted-foreground">
            A board is where users submit and vote on feedback
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleCreateBoard()
          }}
          className="space-y-6"
        >
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
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

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('welcome')}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !boardName.trim()}
              className="flex-1"
            >
              {isLoading ? 'Creating...' : 'Create board'}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  if (step === 'complete') {
    return (
      <div className="space-y-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Check className="h-8 w-8 text-primary" />
        </div>

        <div>
          <h1 className="text-3xl font-bold text-foreground">
            You're all set!
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Your feedback board is ready. Start collecting feedback from your users!
          </p>
        </div>

        <Button onClick={() => router.push('/admin')} size="lg">
          Go to dashboard
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return null
}
