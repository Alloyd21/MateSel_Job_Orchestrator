import { create } from 'zustand'
import type { Job } from '../types/job'

const MAX_LOG_LINES = 5000

interface JobStore {
  jobs: Job[]
  selectedJobId: string | null
  selectJob: (id: string | null) => void
  applyStatusUpdate: (patch: Partial<Job> & { id: string }) => void
  appendLog: (jobId: string, text: string) => void
}

export const useJobStore = create<JobStore>((set) => ({
  jobs: [],
  selectedJobId: null,

  selectJob: (id) => set({ selectedJobId: id }),

  applyStatusUpdate: (patch) =>
    set((state) => {
      const existing = state.jobs.find((j) => j.id === patch.id)
      if (existing) {
        return {
          jobs: state.jobs.map((j) =>
            j.id === patch.id ? { ...j, ...patch, log: patch.log ?? j.log } : j
          )
        }
      }
      const newJob: Job = {
        id: patch.id,
        name: patch.name ?? '',
        jobFolder: patch.jobFolder ?? '',
        outputDir: patch.outputDir ?? '',
        dataFileName: patch.dataFileName,
        status: patch.status ?? 'ready',
        stage: patch.stage,
        startedAt: patch.startedAt,
        finishedAt: patch.finishedAt,
        exitCode: patch.exitCode,
        log: patch.log ?? [],
        batchChanges: patch.batchChanges
      }
      return { jobs: [...state.jobs, newJob] }
    }),

  appendLog: (jobId, text) =>
    set((state) => ({
      jobs: state.jobs.map((j) => {
        if (j.id !== jobId) return j
        const lines = [...j.log, ...text.split('\n').filter(Boolean)]
        return { ...j, log: lines.slice(-MAX_LOG_LINES) }
      })
    }))
}))
