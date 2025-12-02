'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MessageSquare, Sparkles, ArrowRight } from 'lucide-react'

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
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
          <Sparkles className="h-8 w-8 text-white" />
        </div>

        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Welcome, {firstName}!
          </h1>
          <p className="mt-3 text-lg text-gray-600 dark:text-gray-400">
            Let's set up <span className="font-semibold">{organizationName}</span> to start collecting feedback from your users.
          </p>
        </div>

        <div className="space-y-4 text-left">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Here's what we'll do:
          </h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                1
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Create your first feedback board</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">A place for users to submit and vote on ideas</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-700">
                2
              </div>
              <div>
                <p className="font-medium text-gray-500 dark:text-gray-400">Share with your users</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">Get your public board link or embed the widget</p>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => setStep('create-board')}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-6 py-3 text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          Get started
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (step === 'create-board') {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
            <MessageSquare className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
            Create your first board
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
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
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="boardName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Board name
            </label>
            <input
              id="boardName"
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Feature Requests"
            />
          </div>

          <div>
            <label htmlFor="boardDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Description
            </label>
            <textarea
              id="boardDescription"
              value={boardDescription}
              onChange={(e) => setBoardDescription(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Share your ideas and vote on features"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('welcome')}
              className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isLoading || !boardName.trim()}
              className="flex-1 rounded-md bg-black px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              {isLoading ? 'Creating...' : 'Create board'}
            </button>
          </div>
        </form>
      </div>
    )
  }

  if (step === 'complete') {
    return (
      <div className="space-y-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>

        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            You're all set!
          </h1>
          <p className="mt-3 text-lg text-gray-600 dark:text-gray-400">
            Your feedback board is ready. Start collecting feedback from your users!
          </p>
        </div>

        <button
          onClick={() => router.push('/admin')}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-6 py-3 text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          Go to dashboard
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return null
}
