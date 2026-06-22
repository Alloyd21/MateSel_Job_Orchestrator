import { useEffect, useState } from 'react'
import { appendJobLog, applyStatusUpdate } from './jobState'
import { JobQueuePanel } from './components/JobQueuePanel'
import { JobDetailPanel } from './components/JobDetailPanel'
import { AddJobsDialog } from './components/AddJobsDialog'
import { BatchGeneratorDialog } from './components/BatchGeneratorDialog'
import { SettingsModal } from './components/SettingsModal'
import { JobGrid } from './components/JobGrid'
import type { AddJobRequest, AddJobResult, Job, UpdateReadyPayload } from '../../shared'

const githubUrl = 'https://github.com/Alloyd21/MateSel_Job_Orchestrator'

export default function App(): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [showAddJobs, setShowAddJobs] = useState(false)
  const [showBatchGenerator, setShowBatchGenerator] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [gridView, setGridView] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [updateReady, setUpdateReady] = useState<UpdateReadyPayload | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [restartingForUpdate, setRestartingForUpdate] = useState(false)
  const [bulkAction, setBulkAction] = useState<'starting' | 'stopping' | null>(null)

  useEffect(() => {
    window.mateselAPI.getAppVersion().then(setAppVersion)
    window.mateselAPI.getAllJobs().then((existing) => {
      for (const job of existing) setJobs((current) => applyStatusUpdate(current, job))
    })
  }, [])

  useEffect(() => {
    const statusPatches: Array<Partial<Job> & { id: string }> = []
    const logChunks: Array<{ jobId: string; text: string }> = []
    let frame = 0
    const scheduleUpdate = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setJobs((current) => {
          let updated = current
          for (const patch of statusPatches.splice(0)) updated = applyStatusUpdate(updated, patch)
          for (const { jobId, text } of logChunks.splice(0)) updated = appendJobLog(updated, jobId, text)
          return updated
        })
      })
    }

    const unsubStatus = window.mateselAPI.onStatusUpdate((patch) => {
      statusPatches.push(patch)
      scheduleUpdate()
    })
    const unsubLog = window.mateselAPI.onLogChunk((chunk) => {
      logChunks.push(chunk)
      scheduleUpdate()
    })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      unsubStatus()
      unsubLog()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.mateselAPI.onUpdateReady((payload) => {
      setUpdateReady(payload)
      setUpdateDismissed(false)
    })
    return unsubscribe
  }, [])

  const handleClearCompleted = async (includeReady = false): Promise<void> => {
    await window.mateselAPI.clearCompletedJobs(includeReady)
    const currentJobs = await window.mateselAPI.getAllJobs()
    setJobs(currentJobs)
    setSelectedJobId((current) => currentJobs.some((job) => job.id === current) ? current : null)
  }

  const handleStartAll = async (): Promise<void> => {
    setBulkAction('starting')
    try {
      await window.mateselAPI.startAllJobs()
      setJobs(await window.mateselAPI.getAllJobs())
    } finally {
      setBulkAction(null)
    }
  }

  const handleStopAll = async (): Promise<void> => {
    setBulkAction('stopping')
    try {
      await window.mateselAPI.cancelAllJobs()
      setJobs(await window.mateselAPI.getAllJobs())
    } finally {
      setBulkAction(null)
    }
  }

  const handleAddJobs = async (
    requests: Array<string | AddJobRequest>
  ): Promise<AddJobResult[]> => {
    const results = await window.mateselAPI.addJobs(requests)
    setJobs(await window.mateselAPI.getAllJobs())
    return results
  }

  const handleInstallUpdate = async (): Promise<void> => {
    setRestartingForUpdate(true)
    const result = await window.mateselAPI.installUpdateAndRestart()
    if (!result.ready) setRestartingForUpdate(false)
  }

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null
  const showUpdatePrompt = updateReady !== null && !updateDismissed

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-slate-200 overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-700 bg-slate-800 px-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">
            MateSel Orchestrator
          </h1>
          {appVersion && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-medium text-slate-500 hover:text-slate-300"
              title="Open MateSel Orchestrator on GitHub"
            >
              v{appVersion}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded bg-slate-700 p-0.5 text-xs" role="group" aria-label="Job view">
            <button
              type="button"
              aria-pressed={!gridView}
              onClick={() => setGridView(false)}
              className={`rounded px-2.5 py-1 ${!gridView ? 'bg-slate-500 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              List
            </button>
            <button
              type="button"
              aria-pressed={gridView}
              onClick={() => setGridView(true)}
              className={`rounded px-2.5 py-1 ${gridView ? 'bg-slate-500 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              Grid
            </button>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
            title="Settings"
          >
            Settings
          </button>
          <button
            onClick={() => setShowBatchGenerator(true)}
            className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
          >
            Batch Generator
          </button>
          <button
            onClick={() => setShowAddJobs(true)}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
          >
            + Add Jobs
          </button>
        </div>
      </header>

      {showUpdatePrompt && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-800 bg-emerald-950 px-4 py-2 text-sm text-emerald-50">
          <span>
            {updateReady.version
              ? `Update ${updateReady.version} is ready to install.`
              : 'An update is ready to install.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUpdateDismissed(true)}
              className="rounded bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleInstallUpdate}
              disabled={restartingForUpdate}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:bg-emerald-800"
            >
              {restartingForUpdate ? 'Restarting...' : 'Restart to update'}
            </button>
          </div>
        </div>
      )}

      {gridView ? (
        <main className="min-h-0 flex-1 bg-gray-900">
          <JobGrid jobs={jobs} />
        </main>
      ) : (
      <div className="flex flex-1 min-h-0">
        <aside className="w-64 shrink-0 border-r border-slate-700 bg-slate-800 flex flex-col min-h-0">
          <JobQueuePanel
            jobs={jobs}
            selectedJobId={selectedJobId}
            onSelect={setSelectedJobId}
            onStart={window.mateselAPI.startJob}
            onStartAll={handleStartAll}
            onStopAll={handleStopAll}
            bulkAction={bulkAction}
            onClearCompleted={handleClearCompleted}
            onClearAll={() => handleClearCompleted(true)}
            onAddJobs={() => setShowAddJobs(true)}
          />
        </aside>

        <main className="flex-1 min-w-0 bg-gray-900">
          {selectedJob ? (
            <JobDetailPanel
              job={selectedJob}
              onCancel={window.mateselAPI.cancelJob}
              onStart={window.mateselAPI.startJob}
              onRestart={window.mateselAPI.restartJob}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              Select a job to view details
            </div>
          )}
        </main>
      </div>
      )}

      {showAddJobs && (
        <AddJobsDialog
          onClose={() => setShowAddJobs(false)}
          onAdd={handleAddJobs}
        />
      )}
      {showBatchGenerator && (
        <BatchGeneratorDialog onClose={() => setShowBatchGenerator(false)} />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
