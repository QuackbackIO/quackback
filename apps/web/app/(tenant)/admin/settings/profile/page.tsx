import { requireTenant } from '@/lib/tenant'
import { User } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export default async function ProfilePage() {
  const { user } = await requireTenant()

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your personal information</p>
        </div>
      </div>

      {/* Avatar Section */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Avatar</h2>
        <p className="text-sm text-muted-foreground mb-4">Your profile picture</p>
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={user.image || undefined} alt={user.name} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <Button variant="outline">Change avatar</Button>
        </div>
      </div>

      {/* Personal Information */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Personal Information</h2>
        <p className="text-sm text-muted-foreground mb-4">Update your personal details</p>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Full name
              </label>
              <Input id="name" defaultValue={user.name} />
            </div>
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input id="email" type="email" defaultValue={user.email} disabled />
            </div>
          </div>
          <div className="flex justify-end">
            <Button>Save changes</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
