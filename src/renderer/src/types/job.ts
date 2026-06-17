export type JobStatus = 'ready' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface BatchChangeRow {
  item: string
  type: string
  endUse: string
  defaultValue: string
  thisRun: string
}

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
  itersSinceLastChange?: number | null
  aboveNormalPriority?: boolean
  log: string[]
  batchChanges?: BatchChangeRow[]
}

export interface Settings {
  exePath: string
  stopExePath: string
  outputRootDir: string
  saveToInputFolder: boolean
  maxConcurrent: number
}
