import { db, slackThreadSessions, eq, and } from '@/lib/server/db'

export const SLACK_THREAD_IDLE_MS = 45 * 60 * 1000

export async function slackThreadSessionIsActive(
  team: string,
  channel: string,
  thread: string
): Promise<{ active: boolean; lastSpeaker: 'bot' | 'human' | 'none' }> {
  const row = await db.query.slackThreadSessions.findFirst({
    where: and(
      eq(slackThreadSessions.slackTeamId, team),
      eq(slackThreadSessions.channelId, channel),
      eq(slackThreadSessions.threadTs, thread)
    ),
  })
  if (!row || row.status !== 'active') return { active: false, lastSpeaker: 'none' }
  if (Date.now() - row.lastEventAt.getTime() > SLACK_THREAD_IDLE_MS)
    return { active: false, lastSpeaker: 'none' }
  return { active: true, lastSpeaker: row.lastSpeaker }
}

export async function touchSlackThreadSession(
  team: string,
  channel: string,
  thread: string,
  lastSpeaker: 'bot' | 'human'
): Promise<void> {
  await db
    .insert(slackThreadSessions)
    .values({
      slackTeamId: team,
      channelId: channel,
      threadTs: thread,
      status: 'active',
      lastSpeaker,
      lastEventAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        slackThreadSessions.slackTeamId,
        slackThreadSessions.channelId,
        slackThreadSessions.threadTs,
      ],
      set: { status: 'active', lastSpeaker, lastEventAt: new Date() },
    })
}

export async function stopSlackThreadSession(
  team: string,
  channel: string,
  thread: string
): Promise<void> {
  await db
    .update(slackThreadSessions)
    .set({ status: 'stopped', lastEventAt: new Date(), lastSpeaker: 'human' })
    .where(
      and(
        eq(slackThreadSessions.slackTeamId, team),
        eq(slackThreadSessions.channelId, channel),
        eq(slackThreadSessions.threadTs, thread)
      )
    )
}

export async function markSlackThreadHeard(
  team: string,
  channel: string,
  thread: string
): Promise<void> {
  await db
    .update(slackThreadSessions)
    .set({ lastSpeaker: 'human' })
    .where(
      and(
        eq(slackThreadSessions.slackTeamId, team),
        eq(slackThreadSessions.channelId, channel),
        eq(slackThreadSessions.threadTs, thread),
        eq(slackThreadSessions.status, 'active')
      )
    )
}
