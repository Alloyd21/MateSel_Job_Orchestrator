import type { Job } from '../../shared'

const MAX_LOG_LINES = 50000

export function applyStatusUpdate(jobs: Job[], patch: Partial<Job> & { id: string }): Job[] {
  const existing = jobs.find((job) => job.id === patch.id)
  if (existing) {
    return jobs.map((job) =>
      job.id === patch.id ? { ...job, ...patch, log: patch.log ?? job.log } : job
    )
  }

  if (patch.name == null || patch.jobFolder == null) return jobs

  return [
    ...jobs,
    {
      ...patch,
      name: patch.name ?? '',
      jobFolder: patch.jobFolder ?? '',
      outputDir: patch.outputDir ?? '',
      status: patch.status ?? 'ready',
      log: patch.log ?? []
    }
  ]
}

export function appendJobLog(jobs: Job[], jobId: string, text: string): Job[] {
  return jobs.map((job) => {
    if (job.id !== jobId) return job
    const lines = [...job.log, ...text.split('\n').filter(Boolean)]
    return { ...job, log: lines.slice(-MAX_LOG_LINES) }
  })
}
