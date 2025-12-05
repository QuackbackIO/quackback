'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface ProfileFormProps {
  user: {
    id: string
    name: string
    email: string
  }
  initialAvatarUrl: string | null
  hasCustomAvatar: boolean
}

export function ProfileForm({
  user,
  initialAvatarUrl,
  hasCustomAvatar: initialHasCustomAvatar,
}: ProfileFormProps) {
  const [name, setName] = useState(user.name)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isDeletingAvatar, setIsDeletingAvatar] = useState(false)
  const [hasCustomAvatar, setHasCustomAvatar] = useState(initialHasCustomAvatar)
  // Store the current avatar URL - starts with SSR value, updated after uploads
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Use the current avatar URL (base64 from SSR, or local preview after upload)
  const avatarSrc = avatarUrl || undefined

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB')
      return
    }

    // Create local preview immediately (no flicker)
    const localPreviewUrl = URL.createObjectURL(file)

    setIsUploadingAvatar(true)

    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to upload avatar')
      }

      // Update to local preview URL (already loaded, no flicker)
      setAvatarUrl(localPreviewUrl)
      setHasCustomAvatar(true)
      toast.success('Avatar updated')
    } catch (error) {
      // Revoke the object URL on error
      URL.revokeObjectURL(localPreviewUrl)
      toast.error(error instanceof Error ? error.message : 'Failed to upload avatar')
    } finally {
      setIsUploadingAvatar(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDeleteAvatar = async () => {
    setIsDeletingAvatar(true)

    try {
      const response = await fetch('/api/user/profile', {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove avatar')
      }

      setHasCustomAvatar(false)
      setAvatarUrl(null) // Clear avatar, will show fallback initials
      toast.success('Avatar removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove avatar')
    } finally {
      setIsDeletingAvatar(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (name.trim().length < 2) {
      toast.error('Name must be at least 2 characters')
      return
    }

    if (name === user.name) {
      toast.info('No changes to save')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim() }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      toast.success('Profile updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update profile')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Avatar Section */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Avatar</h2>
        <p className="text-sm text-muted-foreground mb-4">Your profile picture</p>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Avatar className="h-16 w-16">
              <AvatarImage src={avatarSrc} alt={name} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            {isUploadingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleAvatarClick}
              disabled={isUploadingAvatar}
            >
              {isUploadingAvatar ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4 mr-2" />
                  Change avatar
                </>
              )}
            </Button>
            {hasCustomAvatar && (
              <Button
                type="button"
                variant="outline"
                onClick={handleDeleteAvatar}
                disabled={isDeletingAvatar}
                className="text-destructive hover:text-destructive"
              >
                {isDeletingAvatar ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Personal Information */}
      <form onSubmit={handleSubmit}>
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="font-medium mb-1">Personal Information</h2>
          <p className="text-sm text-muted-foreground mb-4">Update your personal details</p>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Full name
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input id="email" type="email" defaultValue={user.email} disabled />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
