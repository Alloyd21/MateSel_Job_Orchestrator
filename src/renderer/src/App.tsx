import { useEffect, useState } from 'react'
import { useJobStore } from './store/jobStore'
import { JobQueuePanel } from './components/JobQueuePanel'
import { JobDetailPanel } from './components/JobDetailPanel'
import { AddJobsDialog } from './components/AddJobsDialog'
import { BatchGeneratorDialog } from './components/BatchGeneratorDialog'
import { SettingsModal } from './components/SettingsModal'
import type { Job, JobStatus } from './types/job'
import type { AddJobRequest, AddJobResult } from './globals'

const terminalStatuses: JobStatus[] = ['done', 'failed', 'cancelled']

export default function App(): JSX.Element {
  const { jobs, selectedJobId, selectJob, applyStatusUpdate, appendLog } = useJobStore()
  const [showAddJobs, setShowAddJobs] = useState(false)
  const [showBatchGenerator, setShowBatchGenerator] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
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

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-slate-200 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-800 border-b border-slate-700 shrink-0">
        <h1 className="text-sm font-semibold tracking-wide text-slate-100">
          MateSel Orchestrator
        </h1>
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
          />
        </aside>

        <main className="flex-1 min-w-0 bg-gray-900">
          {selectedJob ? (
            <JobDetailPanel job={selectedJob} onCancel={handleCancel} onRestart={handleRestart} />
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
