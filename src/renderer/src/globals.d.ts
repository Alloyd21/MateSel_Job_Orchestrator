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

export type BatchValueMode = 'value' | 'range' | 'list'

export interface BatchWeightingRow {
  id: string
  kind: 'trait' | 'marker'
  name: string
  lineIndex: number
  values: string[]
}

export interface BatchInspectResult {
  valid: boolean
  warnings: string[]
  needsDataFile: boolean
  dataFileName?: string
  weightingFileName?: string
  files: string[]
  endUseCount: number
  traits: BatchWeightingRow[]
  markers: BatchWeightingRow[]
  markerLocusCount: number
}

export interface BatchVariationSpec {
  rowId: string
  endUseIndex: number
  mode: BatchValueMode
  value: string
  increment?: string
}

export interface BatchGeneratePayload {
  starterFolder: string
  destinationParent: string
  selectedDataFileName?: string
  variations: BatchVariationSpec[]
  allowLargeBatch?: boolean
}

export interface BatchGenerateResult {
  batchFolder: string
  generatedFolders: string[]
  dataFileName?: string
}

export interface UpdateReadyPayload {
  version: string | null
}

declare global {
  interface Window {
    mateselAPI: {
      getAppVersion: () => Promise<string>
      getAllJobs: () => Promise<Job[]>
      inspectBatchStarter: (starterFolder: string) => Promise<BatchInspectResult>
      generateBatchJobs: (payload: BatchGeneratePayload) => Promise<BatchGenerateResult>
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
      installUpdateAndRestart: () => Promise<{ ready: boolean }>
      onStatusUpdate: (cb: (patch: Record<string, unknown>) => void) => () => void
      onLogChunk: (cb: (payload: { jobId: string; text: string }) => void) => () => void
      onUpdateReady: (cb: (payload: UpdateReadyPayload) => void) => () => void
    }
  }
}
