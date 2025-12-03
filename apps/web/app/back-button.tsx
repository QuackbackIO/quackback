'use client'

import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export function BackButton() {
  return (
    <Button
      size="lg"
      variant="outline"
      className="w-full sm:w-auto"
      onClick={() => window.history.back()}
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      Go Back
    </Button>
  )
}
