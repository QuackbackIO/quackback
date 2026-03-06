interface MergeStateActivity {
  type: string
  metadata: Record<string, unknown>
}

/**
 * Activities are returned newest-first. The first relevant event we see for a duplicate
 * reflects its current merge state in the timeline.
 */
export function getLatestMergeStateByDuplicateId(
  activities: MergeStateActivity[]
): Map<string, boolean> {
  const mergeStateByDuplicateId = new Map<string, boolean>()

  for (const activity of activities) {
    if (activity.type === 'post.merged_in') {
      const duplicatePostId = activity.metadata.duplicatePostId
      if (typeof duplicatePostId === 'string' && !mergeStateByDuplicateId.has(duplicatePostId)) {
        mergeStateByDuplicateId.set(duplicatePostId, false)
      }
      continue
    }

    if (activity.type === 'post.unmerged') {
      const otherPostId = activity.metadata.otherPostId
      if (typeof otherPostId === 'string' && !mergeStateByDuplicateId.has(otherPostId)) {
        mergeStateByDuplicateId.set(otherPostId, true)
      }
    }
  }

  return mergeStateByDuplicateId
}
