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

export type BatchWeightingKind = 'trait' | 'marker'
export type BatchValueMode = 'value' | 'range' | 'list'

export interface BatchWeightingRow {
  id: string
  kind: BatchWeightingKind
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
  batchName?: string
  batchTimestamp?: string
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

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface MateSelAPI {
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
  setSettings: (patch: Partial<Settings>) => Promise<void>
  openFolderDialog: (discoverJobs?: boolean) => Promise<string[]>
  openFileDialog: (filters: FileFilter[]) => Promise<string | null>
  getDroppedFilePath: (file: File) => string
  openPath: (targetPath: string) => Promise<string>
  installUpdateAndRestart: () => Promise<{ ready: boolean }>
  onStatusUpdate: (cb: (patch: Partial<Job> & { id: string }) => void) => () => void
  onLogChunk: (cb: (payload: { jobId: string; text: string }) => void) => () => void
  onUpdateReady: (cb: (payload: UpdateReadyPayload) => void) => () => void
}

export function makeBatchTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

export function sanitizeFolderSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '')
}

const numericPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'

function parseFiniteNumber(value: string, label: string): number {
  const normalized = value.replace(/\s+/g, '')
  if (!normalized) throw new Error(`${label} is empty`)
  const number = Number(normalized)
  if (!Number.isFinite(number)) throw new Error(`${label} must be numeric`)
  return number
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

function decimalPlaces(value: string): number {
  const [mantissa, exponentText] = value.replace(/\s+/g, '').toLowerCase().split('e')
  const exponent = exponentText == null ? 0 : Number(exponentText)
  const decimalIndex = mantissa.indexOf('.')
  return Math.max(0, (decimalIndex === -1 ? 0 : mantissa.length - decimalIndex - 1) - exponent)
}

export function expandBatchVariationValues(spec: BatchVariationSpec): string[] {
  if (spec.mode === 'value') return [formatNumber(parseFiniteNumber(spec.value, 'Value'))]

  if (spec.mode === 'list') {
    const values = spec.value.split(',').map((value) => value.trim()).filter(Boolean)
    if (values.length === 0) throw new Error('List must contain at least one numeric value')
    return values.map((value, index) => formatNumber(parseFiniteNumber(value, `List value ${index + 1}`)))
  }

  const match = spec.value.match(new RegExp(`^\\s*(${numericPattern})\\s*-\\s*(${numericPattern})\\s*$`))
  if (!match) throw new Error('Range must use the form start-end, such as 1-4')

  const start = parseFiniteNumber(match[1], 'Range start')
  const end = parseFiniteNumber(match[2], 'Range end')
  const increment = parseFiniteNumber(spec.increment ?? '', 'Range increment')
  if (increment <= 0) throw new Error('Range increment must be greater than 0')
  if (end < start) throw new Error('Range end must be greater than or equal to range start')

  const precision = Math.min(
    12,
    Math.max(decimalPlaces(match[1]), decimalPlaces(match[2]), decimalPlaces(spec.increment ?? '')) + 2
  )
  const values: string[] = []
  const epsilon = increment / 1_000_000
  for (let current = start; current <= end + epsilon; current += increment) {
    values.push(formatNumber(Number(current.toFixed(precision))))
    if (values.length > 10000) throw new Error('Range expands to too many values')
  }
  return values
}
