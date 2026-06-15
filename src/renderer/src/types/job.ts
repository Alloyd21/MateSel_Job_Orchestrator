export type JobStatus = 'ready' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface Job {
  id: string
  name: string
  jobFolder: string
  outputDir: string
  dataFileName?: string
  status: JobStatus
  stage?: string | null
  startedAt?: number | null
  finishedAt?: number | null
  exitCode?: number | null
  log: string[]
}

export interface Settings {
  exePath: string
  stopExePath: string
  outputRootDir: string
  saveToInputFolder: boolean
  maxConcurrent: number
}
