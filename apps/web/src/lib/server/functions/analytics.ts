/**
 * Server functions for the admin briefing page.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import {
  getTrendingPosts,
  getUnrespondedPosts,
  getStalePlannedPosts,
  getNegativeHotspots,
  getActivityCounts,
  getStatusPipeline,
  getResponseHealth,
} from '@/lib/server/domains/analytics'
import { getSentimentBreakdown } from '@/lib/server/domains/sentiment'

const periodSchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('7d'),
})

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const

function periodToDateRange(period: '7d' | '30d' | '90d') {
  const days = PERIOD_DAYS[period]
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  const prevEnd = new Date(start)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - days)
  return { start, end, prevStart, prevEnd }
}

export const getBriefingDataFn = createServerFn({ method: 'GET' })
  .inputValidator(periodSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:analytics] getBriefingData: period=${data.period}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const { start, end, prevStart, prevEnd } = periodToDateRange(data.period)

      const [
        trending,
        unresponded,
        stale,
        negativeHotspots,
        activity,
        prevActivity,
        sentiment,
        prevSentiment,
        pipeline,
        responseHealth,
        prevResponseHealth,
      ] = await Promise.all([
        getTrendingPosts(start, end),
        getUnrespondedPosts(),
        getStalePlannedPosts(),
        getNegativeHotspots(),
        getActivityCounts(start, end),
        getActivityCounts(prevStart, prevEnd),
        getSentimentBreakdown(start, end),
        getSentimentBreakdown(prevStart, prevEnd),
        getStatusPipeline(),
        getResponseHealth(start, end),
        getResponseHealth(prevStart, prevEnd),
      ])

      console.log(
        `[fn:analytics] getBriefingData: trending=${trending.length}, unresponded=${unresponded.totalCount}, pipeline=${pipeline.length}`
      )

      return {
        trending,
        attention: {
          unresponded: {
            totalCount: unresponded.totalCount,
            items: unresponded.items.map((p) => ({
              ...p,
              createdAt: p.createdAt.toISOString(),
            })),
          },
          stale: stale.map((p) => ({
            ...p,
            updatedAt: p.updatedAt.toISOString(),
          })),
          negativeHotspots,
        },
        activity: {
          current: activity,
          previous: prevActivity,
        },
        sentiment: {
          current: sentiment,
          previous: prevSentiment,
        },
        pipeline,
        responseHealth: {
          current: responseHealth,
          previous: prevResponseHealth,
        },
      }
    } catch (error) {
      console.error(`[fn:analytics] ❌ getBriefingData failed:`, error)
      throw error
    }
  })
