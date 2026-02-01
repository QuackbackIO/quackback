import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { useUpdateBoard } from '@/lib/client/mutations'
import { GlobeAltIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import type { BoardId } from '@quackback/ids'

interface Board {
  id: BoardId
  isPublic: boolean
}

interface BoardAccessFormProps {
  board: Board
}

interface FormValues {
  isPublic: boolean
}

export function BoardAccessForm({ board }: BoardAccessFormProps) {
  const mutation = useUpdateBoard()

  const form = useForm<FormValues>({
    defaultValues: {
      isPublic: board.isPublic,
    },
  })

  async function onSubmit(data: FormValues) {
    mutation.mutate({
      id: board.id,
      isPublic: data.isPublic,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {mutation.isError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {mutation.error?.message}
          </div>
        )}

        {/* Board Visibility */}
        <FormField
          control={form.control}
          name="isPublic"
          render={({ field }) => (
            <FormItem className="space-y-4">
              <div>
                <FormLabel className="text-base">Board Visibility</FormLabel>
                <FormDescription>Control who can see this board on your portal</FormDescription>
              </div>
              <FormControl>
                <RadioGroup
                  onValueChange={(value) => field.onChange(value === 'public')}
                  value={field.value ? 'public' : 'private'}
                  className="grid gap-3"
                >
                  <Label
                    htmlFor="visibility-public"
                    className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
                  >
                    <RadioGroupItem value="public" id="visibility-public" className="mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <GlobeAltIcon className="h-4 w-4" />
                        <span className="font-medium">Public</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Anyone can view this board on your portal. Signed-in users can vote,
                        comment, and submit feedback.
                      </p>
                    </div>
                  </Label>
                  <Label
                    htmlFor="visibility-private"
                    className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
                  >
                    <RadioGroupItem value="private" id="visibility-private" className="mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <LockClosedIcon className="h-4 w-4" />
                        <span className="font-medium">Private</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Only team members can view this board
                      </p>
                    </div>
                  </Label>
                </RadioGroup>
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
