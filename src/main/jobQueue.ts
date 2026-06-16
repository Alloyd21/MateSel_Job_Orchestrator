import path from 'path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC } from './ipc/channels'
import { createOutputDir, findMateSelDataFileName, readBatchChanges, type BatchChangeRow } from './fileManager'
import { prepareAndStart, cancelProcess, getRunningPidSet, reattachToRunningJob } from './processRunner'
import { store } from './store'

export interface QueuedJob {
  id: string
  name: string
  jobFolder: string
  outputDir: string
  dataFileName?: string
  status: 'ready' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  stage?: string | null
  startedAt?: number
  finishedAt?: number
  exitCode?: number
  pid?: number
  log: string[]
  batchChanges: BatchChangeRow[]
}

interface JobCache {
  jobs: QueuedJob[]
}

const MAX_LOG_LINES = 5000
const jobCache = new Store<JobCache>({
  name: 'job-cache',
  defaults: { jobs: [] }
})

let win: BrowserWindow | null = null
const pendingReattach: string[] = []
const alivePids = getRunningPidSet()

// Always re-read the folder so a stale cached name never wins. A folder whose
// path changed (or whose data file was replaced) resolves fresh; the stored
// value is only a fallback for folders with no recognizable data file (an
// explicit user pick) or a folder that is currently unreadable.
function resolveDataFileName(jobFolder: string, fallback?: string): string | undefined {
  try {
    return findMateSelDataFileName(jobFolder) ?? fallback
  } catch {
    return fallback
  }
}

function resolveBatchChanges(jobFolder: string): BatchChangeRow[] {
  try {
    return readBatchChanges(jobFolder)
  } catch {
    return []
  }
}

const queue: QueuedJob[] = jobCache.get('jobs', []).map((job) => {
  const resolvedDataFileName = resolveDataFileName(job.jobFolder, job.dataFileName)
  const batchChanges = resolveBatchChanges(job.jobFolder)
  if (job.status === 'running' && job.pid != null && alivePids.has(job.pid)) {
    console.log(`[Recovery] "${job.name}" PID ${job.pid} still running — will reattach`)
    pendingReattach.push(job.id)
    return { ...job, dataFileName: resolvedDataFileName, log: job.log ?? [], batchChanges }
  }
  if (job.status === 'running' || job.status === 'queued') {
    console.log(`[Recovery] "${job.name}" PID ${job.pid ?? 'none'} not found — marking cancelled`)
  }
  return {
    ...job,
    dataFileName: resolvedDataFileName,
    status: job.status === 'running' || job.status === 'queued' ? 'cancelled' : job.status,
    finishedAt:
      job.status === 'running' || job.status === 'queued'
        ? job.finishedAt ?? Date.now()
        : job.finishedAt,
    log: job.log ?? [],
    batchChanges
  }
})
const runningIds = new Set<string>(pendingReattach)

export function init(mainWindow: BrowserWindow): void {
  win = mainWindow
  persistJobs()

  for (const jobId of pendingReattach) {
    const job = queue.find((j) => j.id === jobId)
    if (!job || job.pid == null) continue

    job.log = []
    mainWindow.webContents.send(IPC.JOB_STATUS_UPDATE, { id: jobId, log: [] })

    reattachToRunningJob(
      jobId,
      job.pid,
      job.outputDir,
      job.jobFolder,
      store.get('exePath'),
      onJobComplete,
      (patch) => sendStatusUpdate(jobId, patch),
      (text) => sendLogChunk(jobId, text)
    )
  }
  pendingReattach.length = 0
}

export function getAllJobs(): QueuedJob[] {
  return queue
}

function persistJobs(): void {
  jobCache.set('jobs', queue)
}

function sendStatusUpdate(jobId: string, patch: Record<string, unknown>): void {
  const job = queue.find((j) => j.id === jobId)
  if (job) Object.assign(job, patch)

  persistJobs()
  if (!win) return
  win.webContents.send(IPC.JOB_STATUS_UPDATE, { id: jobId, ...patch })
}

function sendLogChunk(jobId: string, text: string): void {
  const job = queue.find((j) => j.id === jobId)
  if (job) {
    const lines = [...job.log, ...text.split('\n').filter(Boolean)]
    job.log = lines.slice(-MAX_LOG_LINES)
    persistJobs()
  }

  if (!win) return
  win.webContents.send(IPC.JOB_LOG_CHUNK, { jobId, text })
}

export function enqueue(jobFolder: string, dataFileName?: string): void {
  if (!win) return
  const name = path.basename(jobFolder)
  const resolvedDataFileName = dataFileName ?? resolveDataFileName(jobFolder)
  const job: QueuedJob = {
    id: randomUUID(),
    name,
    jobFolder,
    outputDir: '',
    dataFileName: resolvedDataFileName,
    status: 'ready',
    stage: null,
    log: [],
    batchChanges: resolveBatchChanges(jobFolder)
  }
  queue.push(job)
  persistJobs()
  win.webContents.send(IPC.JOB_STATUS_UPDATE, { ...job })
}

export function cancel(jobId: string): void {
  if (!win) return
  const job = queue.find((j) => j.id === jobId)
  if (!job) return

  if (job.status === 'running') {
    cancelProcess(jobId, store.get('stopExePath'))
    runningIds.delete(jobId)
  }

  job.status = 'cancelled'
  job.finishedAt = Date.now()
  job.stage = null
  sendStatusUpdate(jobId, { status: 'cancelled', finishedAt: job.finishedAt, stage: null })
  tick()
}

export function cancelAll(): void {
  if (!win) return
  for (const job of queue) {
    if (!['queued', 'running'].includes(job.status)) continue

    if (job.status === 'running') {
      cancelProcess(job.id, store.get('stopExePath'))
      runningIds.delete(job.id)
    }

    job.status = 'cancelled'
    job.finishedAt = Date.now()
    job.stage = null
    sendStatusUpdate(job.id, {
      status: job.status,
      finishedAt: job.finishedAt,
      stage: null
    })
  }
  tick()
}

export function clearCompleted(): void {
  const terminalStatuses = new Set(['done', 'failed', 'cancelled'])
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (terminalStatuses.has(queue[index].status)) {
      queue.splice(index, 1)
    }
  }
  persistJobs()
}

export function restartFailed(jobId: string): void {
  if (!win) return
  const job = queue.find((j) => j.id === jobId)
  if (!job || job.status !== 'failed') return

  job.outputDir = ''
  job.status = 'ready'
  delete job.startedAt
  delete job.finishedAt
  delete job.exitCode
  job.stage = null
  job.log = []

  sendStatusUpdate(job.id, {
    outputDir: job.outputDir,
    status: job.status,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    stage: null,
    log: []
  })
}

export function start(jobId: string): void {
  if (!win) return
  const job = queue.find((j) => j.id === jobId)
  if (!job || job.status !== 'ready') return

  job.status = 'queued'
  sendStatusUpdate(job.id, {
    status: job.status,
    stage: null
  })
  tick()
}

export function startAll(): void {
  if (!win) return
  for (const job of queue) {
    if (job.status !== 'ready') continue

    job.status = 'queued'
    sendStatusUpdate(job.id, {
      status: job.status,
      stage: null
    })
  }
  tick()
}

function onJobComplete(jobId: string, status: 'done' | 'failed', exitCode: number): void {
  runningIds.delete(jobId)
  const job = queue.find((j) => j.id === jobId)
  if (job) {
    if (job.status === 'cancelled') {
      tick()
      return
    }

    job.status = status
    job.exitCode = exitCode
    job.finishedAt = Date.now()
    sendStatusUpdate(jobId, {
      status,
      exitCode,
      finishedAt: job.finishedAt,
      stage: null
    })
  }
  tick()
}

function tick(): void {
  if (!win) return
  const maxConcurrent = Math.max(1, store.get('maxConcurrent'))

  while (runningIds.size < maxConcurrent) {
    const next = queue.find((j) => j.status === 'queued')
    if (!next) break

    const saveToInputFolder = store.get('saveToInputFolder')
    const outputRoot = store.get('outputRootDir')
    if (!saveToInputFolder && !outputRoot) {
      sendLogChunk(next.id, '[Orchestrator] No output directory configured. Open Settings and set one.\n')
      next.status = 'failed'
      next.finishedAt = Date.now()
      sendStatusUpdate(next.id, {
        status: 'failed',
        finishedAt: next.finishedAt,
        stage: null
      })
      continue
    }

    // Re-resolve from disk at launch so an edited/replaced data file is always
    // picked up, never a value cached from a previous run.
    next.dataFileName = resolveDataFileName(next.jobFolder, next.dataFileName)
    next.outputDir = saveToInputFolder ? next.jobFolder : createOutputDir(outputRoot, next.name)
    next.status = 'running'
    runningIds.add(next.id)
    sendStatusUpdate(next.id, {
      dataFileName: next.dataFileName,
      outputDir: next.outputDir,
      status: next.status,
      stage: null
    })

    const totalActiveJobs = queue.filter((j) => j.status === 'queued' || j.status === 'running').length
    const raisePriority = maxConcurrent > totalActiveJobs

    prepareAndStart(
      win,
      next.jobFolder,
      next.outputDir,
      next.id,
      store.get('exePath'),
      next.dataFileName,
      raisePriority,
      onJobComplete,
      (patch) => sendStatusUpdate(next.id, patch),
      (text) => sendLogChunk(next.id, text)
    )
  }
}
