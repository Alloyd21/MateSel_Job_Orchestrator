import type { JobStatus } from '../../../shared'

const config: Record<JobStatus, { label: string; classes: string }> = {
  ready: { label: 'Ready', classes: 'bg-emerald-800 text-emerald-100' },
  queued: { label: 'Queued', classes: 'bg-slate-600 text-slate-200' },
  running: { label: 'Running', classes: 'bg-blue-600 text-white animate-pulse' },
  done: { label: 'Done', classes: 'bg-green-700 text-green-100' },
  failed: { label: 'Failed', classes: 'bg-red-700 text-red-100' },
  cancelled: { label: 'Cancelled', classes: 'bg-yellow-700 text-yellow-100' }
}

export function StatusBadge({ status }: { status: JobStatus }): JSX.Element {
  const { label, classes } = config[status]
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  )
}
