'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { signUp, createOrganization, setActiveOrganization } from '@/lib/auth/client'
import { signupSchema, type SignupInput } from '@/lib/schemas/auth'
import { OAuthButtons } from './oauth-buttons'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

export function SignupForm() {
  const router = useRouter()
  const [error, setError] = useState('')

  const form = useForm<SignupInput>({
    resolver: standardSchemaResolver(signupSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      orgName: '',
    },
  })

  async function onSubmit(data: SignupInput) {
    setError('')

    try {
      const { error: signUpError } = await signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
      })

      if (signUpError) {
        throw new Error(signUpError.message)
      }

      const { data: org, error: orgError } = await createOrganization({
        name: data.orgName,
        slug: data.orgName
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, ''),
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

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

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

          <FormField
            control={form.control}
            name="orgName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Organization Name</FormLabel>
                <FormControl>
                  <Input placeholder="Acme Inc." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting ? 'Creating account...' : 'Create account'}
          </Button>
        </form>
      </Form>
    </div>
  )
}
