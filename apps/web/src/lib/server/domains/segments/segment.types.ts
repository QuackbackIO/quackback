/**
 * Segment domain types
 */

import type { SegmentId } from '@quackback/ids'
import type { SegmentRules, EvaluationSchedule, SegmentWeightConfig } from '@/lib/server/db'

// ============================================
// Core types
// ============================================

export interface Segment {
  id: SegmentId
  name: string
  description: string | null
  type: 'manual' | 'dynamic'
  color: string
  rules: SegmentRules | null
  evaluationSchedule: EvaluationSchedule | null
  weightConfig: SegmentWeightConfig | null
  createdAt: Date
  updatedAt: Date
}

/** Segment with member count included */
export interface SegmentWithCount extends Segment {
  memberCount: number
}

/** Lightweight segment summary for attaching to user records */
export interface SegmentSummary {
  id: SegmentId
  name: string
  color: string
  type: 'manual' | 'dynamic'
}

// ============================================
// Input types
// ============================================

export interface CreateSegmentInput {
  name: string
  description?: string
  type: 'manual' | 'dynamic'
  color?: string
  rules?: SegmentRules
  evaluationSchedule?: EvaluationSchedule
  weightConfig?: SegmentWeightConfig
}

export interface UpdateSegmentInput {
  name?: string
  description?: string | null
  color?: string
  rules?: SegmentRules | null
  evaluationSchedule?: EvaluationSchedule | null
  weightConfig?: SegmentWeightConfig | null
}

// ============================================
// Result types
// ============================================

export interface EvaluationResult {
  segmentId: SegmentId
  added: number
  removed: number
}
