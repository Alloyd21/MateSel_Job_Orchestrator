import { beforeEach, describe, expect, it } from 'vitest'
import { useJobStore } from './jobStore'

beforeEach(() => {
  useJobStore.setState({ jobs: [], selectedJobId: null })
})

describe('jobStore', () => {
  it('adds a job from a status update and preserves its existing log on later updates', () => {
    useJobStore.getState().applyStatusUpdate({
      id: 'job-1',
      name: 'Run 1',
      jobFolder: 'C:\\Runs\\Run 1',
      outputDir: '',
      status: 'ready'
    })
    useJobStore.getState().appendLog('job-1', 'first line\n')
    useJobStore.getState().applyStatusUpdate({
      id: 'job-1',
      status: 'running',
      outputDir: 'C:\\Output\\Run 1'
    })

    expect(useJobStore.getState().jobs).toEqual([
      expect.objectContaining({
        id: 'job-1',
        name: 'Run 1',
        status: 'running',
        outputDir: 'C:\\Output\\Run 1',
        log: ['first line']
      })
    ])
  })

  it('keeps only the most recent 5000 log lines', () => {
    useJobStore.getState().applyStatusUpdate({
      id: 'job-1',
      name: 'Run 1',
      jobFolder: 'C:\\Runs\\Run 1',
      outputDir: '',
      status: 'running'
    })

    const lines = Array.from({ length: 5002 }, (_, index) => `line ${index}`).join('\n')
    useJobStore.getState().appendLog('job-1', lines)

    const job = useJobStore.getState().jobs[0]
    expect(job.log).toHaveLength(5000)
    expect(job.log[0]).toBe('line 2')
    expect(job.log.at(-1)).toBe('line 5001')
  })
})
