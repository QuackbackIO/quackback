'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createWorkspaceSchema, type CreateWorkspaceInput } from '@/lib/schemas/auth'
import { getBaseDomain } from '@/lib/routing'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'

/**
 * Create Workspace Form
 *
 * Used on the main domain to create a new tenant (org + user).
 * After creation, redirects to the subdomain with a session cookie.
 */
export function CreateWorkspaceForm() {
  const [error, setError] = useState('')
  const [baseDomain, setBaseDomain] = useState('')

  useEffect(() => {
    setBaseDomain(getBaseDomain(window.location.host))
  }, [])

  const form = useForm<CreateWorkspaceInput>({
    resolver: standardSchemaResolver(createWorkspaceSchema),
    defaultValues: {
      workspaceName: '',
      workspaceSlug: '',
      name: '',
      email: '',
      password: '',
    },
  })

  // Auto-generate slug from workspace name
  const workspaceName = form.watch('workspaceName')
  useEffect(() => {
    if (workspaceName) {
      const slug = workspaceName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 32)
      form.setValue('workspaceSlug', slug, { shouldValidate: true })
    }
  }, [workspaceName, form])

  async function onSubmit(data: CreateWorkspaceInput) {
    setError('')

    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create workspace')
      }

      // Redirect to subdomain with one-time transfer token
      // The /api/auth/complete endpoint will set the session cookie on the subdomain
      window.location.href = result.redirectUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Workspace Details</h3>

          <FormField
            control={form.control}
            name="workspaceName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Workspace Name</FormLabel>
                <FormControl>
                  <Input placeholder="Acme Inc." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="workspaceSlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Workspace URL</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <Input placeholder="acme" {...field} className="max-w-[200px]" />
                    <span className="text-sm text-muted-foreground">.{baseDomain}</span>
                  </div>
                </FormControl>
                <FormDescription>This will be your unique workspace URL</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Your Account</h3>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Your Name</FormLabel>
                <FormControl>
                  <Input placeholder="John Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="you@example.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Min. 8 characters" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating workspace...
            </>
          ) : (
            'Create workspace'
          )}
        </Button>
      </form>
    </Form>
  )
}
