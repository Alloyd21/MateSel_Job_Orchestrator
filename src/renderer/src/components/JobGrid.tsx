import { useEffect, useState } from 'react'
import type { Job } from '../../../shared'

function formatElapsed(job: Job, now: number): string {
  if (!job.startedAt) return '--:--'
  const seconds = Math.max(0, Math.floor(((job.finishedAt ?? now) - job.startedAt) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

const borderClasses: Record<Job['status'], string> = {
  ready: 'border-slate-600',
  queued: 'border-amber-700',
  running: 'border-cyan-600',
  done: 'border-emerald-700',
  failed: 'border-red-700',
  cancelled: 'border-slate-700'
}

export function JobGrid({ jobs }: { jobs: Job[] }): JSX.Element {
  const [now, setNow] = useState(Date.now())
  const hasRunningJobs = jobs.some((job) => job.status === 'running')

  useEffect(() => {
    if (!hasRunningJobs) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasRunningJobs])

  if (jobs.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">No jobs yet</div>
  }

  const columns = Math.ceil(Math.sqrt(jobs.length))
  const rows = Math.ceil(jobs.length / columns)

  return (
    <div
      className="grid h-full min-h-0 gap-2 p-2"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
      }}
    >
      {jobs.map((job) => (
        <div
          key={job.id}
          className={`relative grid min-h-0 min-w-0 grid-rows-4 overflow-hidden rounded-lg border-2 bg-slate-800 p-2 text-center ${borderClasses[job.status]}`}
          style={{ containerType: 'size' }}
          title={`${job.name} (${job.status})`}
        >
          {job.aboveNormalPriority && job.status === 'running' && (
            <svg
              aria-label="Above normal priority"
              viewBox="0 0 24 24"
              className="absolute left-1 top-1 h-4 w-4 text-amber-400"
              fill="currentColor"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          )}
          <div className="self-center truncate font-semibold leading-tight text-slate-100 text-[clamp(0.65rem,7cqh,1.5rem)]">
            {job.name}
          </div>
          <div className="self-center font-mono leading-none text-slate-300 text-[clamp(0.75rem,10cqh,2rem)]">
            {formatElapsed(job, now)}
          </div>
          <div className="self-center font-mono font-semibold leading-none text-cyan-200 text-[clamp(0.75rem,10cqh,2rem)]">
            {job.stage === 'Optimising Matings' || job.convergencePercent != null
              ? job.convergencePercent == null ? '—' : `${job.convergencePercent}%`
              : job.stage ?? job.status}
          </div>
          <div className="self-center font-mono leading-none text-slate-400 text-[clamp(0.65rem,7cqh,1.5rem)]">
            GensSinceChange: {job.itersSinceLastChange?.toLocaleString() ?? '—'}
          </div>
        </div>
      ))}
    </div>
  )
}
