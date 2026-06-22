import { spawnSync } from 'child_process'
import os from 'os'

function detectLogicalProcessors(): number {
  const fallback = os.availableParallelism()
  if (process.platform !== 'win32') return fallback

  const command = `
Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint GetActiveProcessorCount(ushort groupNumber);' -Name ProcessorGroups -Namespace Native
[Native.ProcessorGroups]::GetActiveProcessorCount(0xffff)
`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 3000
  })
  const detected = Number(result.stdout.trim())
  return Number.isInteger(detected) && detected > 0 ? Math.max(detected, fallback) : fallback
}

export const logicalProcessors = detectLogicalProcessors()
export const maxConcurrentJobs = Math.max(1, Math.floor(logicalProcessors * 0.8))
