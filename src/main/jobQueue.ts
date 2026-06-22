import path from 'path'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow } from 'electron'
import Store from 'electron-store'
import type { BatchChangeRow, Job } from '../shared'
import { IPC } from './ipc/channels'
import { maxConcurrentJobs } from './systemCapacity'
import { createOutputDir, findMateSelDataFileName, readBatchChanges } from './fileManager'
import { prepareAndStart, cancelProcess, getRunningPidSet, reattachToRunningJob } from './processRunner'
import { store } from './store'

interface QueuedJob extends Job {
  pid?: number
  batchChanges: BatchChangeRow[]
}

const MAX_LOG_LINES = 50000
const jobCache = new Store<{ jobs: QueuedJob[] }>({
  name: 'job-cache',
  defaults: { jobs: [] }
})

let win: BrowserWindow | null = null
let persistTimer: NodeJS.Timeout | undefined
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
const queueActivityListeners = new Set<(hasActive: boolean) => void>()
let lastActiveState = queue.some((job) => job.status === 'queued' || job.status === 'running')

export function init(mainWindow: BrowserWindow): void {
  win = mainWindow
  persistJobs()
  app.once('before-quit', persistJobs)

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

export function hasActiveJobs(): boolean {
  return queue.some((job) => job.status === 'queued' || job.status === 'running')
}

export function onQueueActivityChange(listener: (hasActive: boolean) => void): () => void {
  queueActivityListeners.add(listener)
  listener(hasActiveJobs())
  return () => queueActivityListeners.delete(listener)
}

function notifyQueueActivityIfChanged(): void {
  const hasActive = hasActiveJobs()
  if (hasActive === lastActiveState) return

  lastActiveState = hasActive
  for (const listener of queueActivityListeners) {
    listener(hasActive)
  }
}

function persistJobs(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = undefined
  jobCache.set('jobs', queue.map((job) => ({ ...job, log: [] })))
}

function persistJobsSoon(): void {
  if (persistTimer) return
  persistTimer = setTimeout(persistJobs, 1000)
}

function sendStatusUpdate(jobId: string, patch: Record<string, unknown>): void {
  const job = queue.find((j) => j.id === jobId)
  if (job) Object.assign(job, patch)

  persistJobsSoon()
  notifyQueueActivityIfChanged()
  if (!win) return
  win.webContents.send(IPC.JOB_STATUS_UPDATE, { id: jobId, ...patch })
}

function sendLogChunk(jobId: string, text: string): void {
  const job = queue.find((j) => j.id === jobId)
  if (job) {
    const lines = [...job.log, ...text.split('\n').filter(Boolean)]
    job.log = lines.slice(-MAX_LOG_LINES)
    persistJobsSoon()
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

function cancelJob(job: QueuedJob): void {
  if (job.status === 'running') {
    cancelProcess(job.id, store.get('stopExePath'))
    runningIds.delete(job.id)
  }

  job.status = 'cancelled'
  job.finishedAt = Date.now()
  job.stage = null
  job.aboveNormalPriority = false
  sendStatusUpdate(job.id, {
    status: job.status,
    finishedAt: job.finishedAt,
    stage: null,
    itersSinceLastChange: null,
    aboveNormalPriority: false
  })
}

export function cancel(jobId: string): void {
  if (!win) return
  const job = queue.find((j) => j.id === jobId)
  if (!job) return

  cancelJob(job)
  tick()
}

export function cancelAll(): void {
  if (!win) return
  for (const job of queue) {
    if (!['queued', 'running'].includes(job.status)) continue

    cancelJob(job)
  }
  tick()
}

export function clearCompleted(includeReady = false): void {
  const terminalStatuses = new Set(['done', 'failed', 'cancelled'])
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (terminalStatuses.has(queue[index].status) || (includeReady && queue[index].status === 'ready')) {
      queue.splice(index, 1)
    }
  }
  persistJobs()
}

export function restartFailed(jobId: string): void {
  if (!win) return
  const job = queue.find((j) => j.id === jobId)
  if (!job || !['done', 'failed', 'cancelled'].includes(job.status)) return

  job.outputDir = ''
  job.status = 'queued'
  delete job.startedAt
  delete job.finishedAt
  delete job.exitCode
  job.stage = null
  job.convergencePercent = null
  job.log = []

  sendStatusUpdate(job.id, {
    outputDir: job.outputDir,
    status: job.status,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    stage: null,
    itersSinceLastChange: null,
    convergencePercent: null,
    log: []
  })
  tick()
}

function queueJob(job: QueuedJob): void {
  job.status = 'queued'
  sendStatusUpdate(job.id, { status: job.status, stage: null })
}

export function start(jobId: string): void {
  if (!win) return
  const job = queue.find((j) => j.id === jobId)
  if (!job || job.status !== 'ready') return

  queueJob(job)
  tick()
}

export function startAll(): void {
  if (!win) return
  for (const job of queue) {
    if (job.status !== 'ready') continue

    queueJob(job)
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
    job.aboveNormalPriority = false
    sendStatusUpdate(jobId, {
      status,
      exitCode,
      finishedAt: job.finishedAt,
      stage: null,
      aboveNormalPriority: false
    })
  }
  tick()
}

function tick(): void {
  if (!win) return
  const maxConcurrent = Math.min(maxConcurrentJobs, Math.max(1, store.get('maxConcurrent')))

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

    const raisePriority = maxConcurrent < maxConcurrentJobs

    next.aboveNormalPriority = raisePriority
    sendStatusUpdate(next.id, { aboveNormalPriority: raisePriority })

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
