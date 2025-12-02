'use client'

import { useState } from 'react'
import { createOrganization } from '@/lib/auth/client'
import { buildOrgUrl } from '@/lib/routing'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function CreateOrgForm() {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(slugify(value))
    }
  }

  const handleSlugChange = (value: string) => {
    setSlugEdited(true)
    setSlug(slugify(value))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    if (!name.trim()) {
      setError('Organization name is required')
      setIsLoading(false)
      return
    }

    if (!slug.trim()) {
      setError('URL slug is required')
      setIsLoading(false)
      return
    }

    if (slug.length < 3) {
      setError('URL slug must be at least 3 characters')
      setIsLoading(false)
      return
    }

    try {
      const { error: createError } = await createOrganization({
        name: name.trim(),
        slug: slug.trim(),
      })

      if (createError) {
        throw new Error(createError.message)
      }

      // Redirect to admin (which will redirect to onboarding if no boards)
      const orgUrl = buildOrgUrl(slug, '/admin')
      window.location.href = orgUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-foreground">
          Organization name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Acme Inc"
        />
      </div>

      <div>
        <label htmlFor="slug" className="block text-sm font-medium text-foreground">
          URL
        </label>
        <div className="mt-1 flex rounded-md shadow-sm">
          <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
            {typeof window !== 'undefined'
              ? `${window.location.protocol}//`
              : 'https://'}
          </span>
          <input
            id="slug"
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            required
            className="block w-full min-w-0 flex-1 border border-input bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="acme"
          />
          <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
            .localhost:3000
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          This will be your organization's unique URL
        </p>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isLoading ? 'Creating...' : 'Create organization'}
      </button>
    </form>
  )
}
