import { describe, expect, it } from 'vitest'
import { appendJobLog, applyStatusUpdate } from './jobState'

describe('job state', () => {
  it('adds a job, merges later status updates, and preserves its log', () => {
    let jobs = applyStatusUpdate([], {
      id: 'job-1',
      name: 'Run 1',
      jobFolder: 'C:\\Runs\\Run 1',
      outputDir: '',
      status: 'ready',
      itersSinceLastChange: 12
    })
    jobs = appendJobLog(jobs, 'job-1', 'first line\n')
    jobs = applyStatusUpdate(jobs, {
      id: 'job-1',
      status: 'running',
      outputDir: 'C:\\Output\\Run 1'
    })

    expect(jobs).toEqual([
      expect.objectContaining({
        id: 'job-1',
        name: 'Run 1',
        status: 'running',
        outputDir: 'C:\\Output\\Run 1',
        itersSinceLastChange: 12,
        log: ['first line']
      })
    ])
  })

  it('keeps only the most recent 50000 log lines', () => {
    const job = applyStatusUpdate([], {
      id: 'job-1',
      name: 'Run 1',
      jobFolder: 'C:\\Runs\\Run 1',
      outputDir: '',
      status: 'running'
    })
    const lines = Array.from({ length: 50002 }, (_, index) => `line ${index}`).join('\n')
    const updated = appendJobLog(job, 'job-1', lines)[0]

    expect(updated.log).toHaveLength(50000)
    expect(updated.log[0]).toBe('line 2')
    expect(updated.log.at(-1)).toBe('line 50001')
  })

  it('does not recreate a cleared job from a delayed status update', () => {
    expect(applyStatusUpdate([], { id: 'cleared-job', status: 'cancelled' })).toEqual([])
  })
})
