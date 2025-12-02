'use client'

import { useState } from 'react'
import { createOrganization } from '@/lib/auth/client'
import { buildOrgUrl } from '@/lib/routing'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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

      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          Organization name
        </label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          required
          placeholder="Acme Inc"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="slug" className="text-sm font-medium">
          URL
        </label>
        <div className="flex rounded-md shadow-xs">
          <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
            {typeof window !== 'undefined'
              ? `${window.location.protocol}//`
              : 'https://'}
          </span>
          <Input
            id="slug"
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            required
            placeholder="acme"
            className="rounded-none border-x-0"
          />
          <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
            .localhost:3000
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          This will be your organization's unique URL
        </p>
      </div>

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? 'Creating...' : 'Create organization'}
      </Button>
    </form>
  )
}
