import type { Job, Settings } from './types/job'

export interface AddJobRequest {
  folder: string
  dataFileName?: string
}

export interface AddJobResult {
  folder: string
  valid: boolean
  warnings: string[]
  needsDataFile?: boolean
  files?: string[]
}

declare global {
  interface Window {
    mateselAPI: {
      getAllJobs: () => Promise<Job[]>
      addJobs: (jobs: Array<string | AddJobRequest>) => Promise<AddJobResult[]>
      cancelJob: (jobId: string) => Promise<void>
      cancelAllJobs: () => Promise<void>
      clearCompletedJobs: () => Promise<void>
      restartJob: (jobId: string) => Promise<void>
      startJob: (jobId: string) => Promise<void>
      startAllJobs: () => Promise<void>
      getSettings: () => Promise<Settings>
      setSettings: (patch: Record<string, unknown>) => Promise<void>
      openFolderDialog: (discoverJobs?: boolean) => Promise<string[]>
      openFileDialog: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>
      openPath: (targetPath: string) => Promise<string>
      onStatusUpdate: (cb: (patch: Record<string, unknown>) => void) => () => void
      onLogChunk: (cb: (payload: { jobId: string; text: string }) => void) => () => void
    }
  }
}
