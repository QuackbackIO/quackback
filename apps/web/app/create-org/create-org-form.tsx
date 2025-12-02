'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createOrganization } from '@/lib/auth/client'
import { buildOrgUrl } from '@/lib/routing'
import { createOrgSchema, type CreateOrgInput } from '@/lib/schemas/auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function CreateOrgForm() {
  const [error, setError] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)

  const form = useForm<CreateOrgInput>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: {
      name: '',
      slug: '',
    },
  })

  function handleNameChange(value: string) {
    form.setValue('name', value)
    if (!slugEdited) {
      form.setValue('slug', slugify(value))
    }
  }

  function handleSlugChange(value: string) {
    setSlugEdited(true)
    form.setValue('slug', slugify(value))
  }

  async function onSubmit(data: CreateOrgInput) {
    setError('')

    try {
      const { error: createError } = await createOrganization({
        name: data.name.trim(),
        slug: data.slug.trim(),
      })

      if (createError) {
        throw new Error(createError.message)
      }

      const orgUrl = buildOrgUrl(data.slug, '/admin')
      window.location.href = orgUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization name</FormLabel>
              <FormControl>
                <Input
                  placeholder="Acme Inc"
                  {...field}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>URL</FormLabel>
              <div className="flex rounded-md shadow-xs">
                <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                  {typeof window !== 'undefined' ? `${window.location.protocol}//` : 'https://'}
                </span>
                <FormControl>
                  <Input
                    placeholder="acme"
                    className="rounded-none border-x-0"
                    {...field}
                    onChange={(e) => handleSlugChange(e.target.value)}
                  />
                </FormControl>
                <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                  .quackback.localhost:3000
                </span>
              </div>
              <FormDescription>This will be your organization's unique URL</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? 'Creating...' : 'Create organization'}
        </Button>
      </form>
    </Form>
  )
}
