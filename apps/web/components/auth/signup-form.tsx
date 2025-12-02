'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signUp, createOrganization, setActiveOrganization } from '@/lib/auth/client'
import { OAuthButtons } from './oauth-buttons'

export function SignupForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const { error: signUpError } = await signUp.email({
        email,
        password,
        name,
      })

      if (signUpError) {
        throw new Error(signUpError.message)
      }

      const { data: org, error: orgError } = await createOrganization({
        name: orgName,
        slug: orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      })

      if (orgError) {
        throw new Error(orgError.message)
      }

      if (org) {
        await setActiveOrganization({ organizationId: org.id })
      }

      router.push('/admin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <OAuthButtons mode="signup" />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-background px-2 text-muted-foreground">Or continue with email</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Your Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="John Doe"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Min. 8 characters"
          />
        </div>

        <div>
          <label htmlFor="orgName" className="block text-sm font-medium">
            Organization Name
          </label>
          <input
            id="orgName"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Acme Inc."
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isLoading ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
