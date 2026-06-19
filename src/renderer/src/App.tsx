import { useEffect, useState } from 'react'
import { useJobStore } from './store/jobStore'
import { JobQueuePanel } from './components/JobQueuePanel'
import { JobDetailPanel } from './components/JobDetailPanel'
import { AddJobsDialog } from './components/AddJobsDialog'
import { BatchGeneratorDialog } from './components/BatchGeneratorDialog'
import { SettingsModal } from './components/SettingsModal'
import type { Job, JobStatus } from './types/job'
import type { AddJobRequest, AddJobResult, UpdateReadyPayload } from './globals'

const terminalStatuses: JobStatus[] = ['done', 'failed', 'cancelled']
const githubUrl = 'https://github.com/Alloyd21/MateSel_Job_Orchestrator'

export default function App(): JSX.Element {
  const { jobs, selectedJobId, selectJob, applyStatusUpdate, appendLog } = useJobStore()
  const [showAddJobs, setShowAddJobs] = useState(false)
  const [showBatchGenerator, setShowBatchGenerator] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [updateReady, setUpdateReady] = useState<UpdateReadyPayload | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [restartingForUpdate, setRestartingForUpdate] = useState(false)

  useEffect(() => {
    window.mateselAPI.getAppVersion().then(setAppVersion)
    window.mateselAPI.getAllJobs().then((existing: Job[]) => {
      for (const job of existing) applyStatusUpdate(job)
    })
  }, [])

  useEffect(() => {
    const unsubStatus = window.mateselAPI.onStatusUpdate((patch) => {
      applyStatusUpdate(patch as Partial<Job> & { id: string })
    })
    const unsubLog = window.mateselAPI.onLogChunk(({ jobId, text }) => {
      appendLog(jobId, text)
    })
    return () => {
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

  const handleAddJobs = async (jobsToAdd: Array<string | AddJobRequest>): Promise<AddJobResult[]> => {
    return window.mateselAPI.addJobs(jobsToAdd)
  }

  const handleCancel = async (jobId: string): Promise<void> => {
    await window.mateselAPI.cancelJob(jobId)
  }

  const handleCancelAll = async (): Promise<void> => {
    await window.mateselAPI.cancelAllJobs()
  }

  const handleRestart = async (jobId: string): Promise<void> => {
    await window.mateselAPI.restartJob(jobId)
  }

  const handleStart = async (jobId: string): Promise<void> => {
    await window.mateselAPI.startJob(jobId)
  }

  const handleStartAll = async (): Promise<void> => {
    await window.mateselAPI.startAllJobs()
  }

  const handleClearCompleted = async (): Promise<void> => {
    const completedIds = new Set(
      jobs.filter((j) => terminalStatuses.includes(j.status)).map((j) => j.id)
    )
    await window.mateselAPI.clearCompletedJobs()
    useJobStore.setState((state) => ({
      jobs: state.jobs.filter((j) => !completedIds.has(j.id)),
      selectedJobId: completedIds.has(state.selectedJobId ?? '') ? null : state.selectedJobId
    }))
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
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-800 border-b border-slate-700 shrink-0">
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

      <div className="flex flex-1 min-h-0">
        <aside className="w-64 shrink-0 border-r border-slate-700 bg-slate-800 flex flex-col min-h-0">
          <JobQueuePanel
            jobs={jobs}
            selectedJobId={selectedJobId}
            onSelect={selectJob}
            onStart={handleStart}
            onStartAll={handleStartAll}
            onStopAll={handleCancelAll}
            onClearCompleted={handleClearCompleted}
            onAddJobs={() => setShowAddJobs(true)}
          />
        </aside>

        <main className="flex-1 min-w-0 bg-gray-900">
          {selectedJob ? (
            <JobDetailPanel
              job={selectedJob}
              onCancel={handleCancel}
              onStart={handleStart}
              onRestart={handleRestart}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              Select a job to view details
            </div>
          )}
        </main>
      </div>

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
