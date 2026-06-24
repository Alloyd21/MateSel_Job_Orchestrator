import { spawn, spawnSync, ChildProcess } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { BrowserWindow } from 'electron'
import { IPC } from './ipc/channels'
import { findFileNameCaseInsensitive, prepareMateSelDataFile } from './fileManager'

export type JobCompleteCallback = (jobId: string, status: 'done' | 'failed', exitCode: number) => void
export type JobStatusCallback = (patch: Record<string, unknown>) => void
export type JobLogCallback = (text: string) => void

const CONSOLE_POLL_INTERVAL_MS = 1000
const CANCEL_TIMEOUT_MS = 5000

const runningProcesses = new Map<string, ChildProcess>()
const consolePollers = new Map<string, NodeJS.Timeout>()
const orphanedPids = new Map<string, number>()
const completionPollers = new Map<string, NodeJS.Timeout>()
const cancellingJobs = new Set<string>()

// Raises the worker above other apps (ABOVE_NORMAL, not HIGH/REALTIME which can
// starve the OS). The OS scheduler distributes workers across logical processors.
// Priority is only raised when configured capacity exceeds active jobs.
function applyPerformanceTuning(
  pid: number,
  raisePriority: boolean,
  sendLog: (text: string) => void
): void {
  if (raisePriority) {
    try {
      os.setPriority(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      sendLog(`[Orchestrator] Could not raise process priority: ${msg}\n`)
    }
  }

  if (raisePriority) sendLog('[Orchestrator] Worker priority set to Above Normal.\n')
}

const fatalOutputPatterns = [
  /could not find token file/i,
  /engine authentication inputs are invalid/i,
  /forrtl:\s+severe/i,
  /access violation/i,
  /\bstopping\./i
]

interface IterationState {
  inOptimization: boolean
  currentGen: number
  lastImprovementGen: number
}

// After "FrontierDone", MateSel prints optimization rows:
//   Gen NewGen Sires   xG  ...  Fitness  Conv% Seconds   <- improvement row (all cols)
//   Gen NewGen                  Conv% Seconds            <- checkpoint row (blanks in middle)
// Improvement rows have a 3rd integer (Sires) followed by a decimal (xG).
// Checkpoint rows have only Gen + NewGen then spaces.
// itersSinceLastChange = currentGen - lastImprovementGen.
function detectItersSinceLastChange(text: string, state: IterationState): number | null {
  if (!state.inOptimization) {
    if (!/frontierdone\s*=\s*true/i.test(text)) return null
    state.inOptimization = true
  }

  for (const match of text.matchAll(/^\s+(\d+)\s+\d+\s+\d+\s+\d+\.\d/gm)) {
    const gen = Number(match[1])
    if (gen > state.lastImprovementGen) state.lastImprovementGen = gen
  }

  for (const match of text.matchAll(/^\s+(\d+)\s+\d+\s/gm)) {
    const gen = Number(match[1])
    if (gen > state.currentGen) state.currentGen = gen
  }

  if (state.lastImprovementGen === 0) return null
  return state.currentGen - state.lastImprovementGen
}

function detectMateSelStage(text: string): string | undefined {
  const lowerText = text.toLowerCase()
  const frontierPointMatches = [...lowerText.matchAll(/frontier point calc #\s*(\d+)/g)]
  const latestFrontierPoint = frontierPointMatches.at(-1)
  const frontierPointIndex = latestFrontierPoint?.index ?? -1
  const frontierPointNumber = latestFrontierPoint ? Number(latestFrontierPoint[1]) : NaN
  const frontierProgress =
    Number.isFinite(frontierPointNumber) && frontierPointNumber > 0
      ? Math.min(90, Math.max(0, Math.round(frontierPointNumber * 9)))
      : undefined
  const matches = [
    { index: lowerText.lastIndexOf('inbreeding coefficients'), stage: 'Calculating Inbreeding' },
    { index: lowerText.lastIndexOf('frontierstarted'), stage: 'Calculating Frontier' },
    {
      index: frontierPointIndex,
      stage:
        frontierProgress == null
          ? 'Calculating Frontier'
          : `Calculating Frontier ${frontierProgress}%`
    },
    { index: lowerText.lastIndexOf('frontierdone'), stage: 'Optimising Matings' }
  ].filter((match) => match.index >= 0)

  if (matches.length === 0) return undefined
  return matches.sort((a, b) => b.index - a.index)[0].stage
}

function hasFatalMateSelOutput(text: string): boolean {
  return fatalOutputPatterns.some((pattern) => pattern.test(text))
}

export function createStageTextHandler(onStatus: JobStatusCallback): (text: string) => void {
  let currentStage: string | null = null
  const iterState: IterationState = { inOptimization: false, currentGen: 0, lastImprovementGen: 0 }
  let lastReportedIters: number | null = null
  let lastReportedConvergence: number | null = null
  let pendingText = ''

  return (text) => {
    const lines = `${pendingText}${text}`.split(/\r?\n/)
    pendingText = lines.pop() ?? ''
    const completeText = lines.join('\n')
    if (!completeText) return

    const nextStage = detectMateSelStage(completeText)
    if (nextStage && nextStage !== currentStage) {
      currentStage = nextStage
      onStatus({ stage: nextStage })
    }

    const iters = detectItersSinceLastChange(completeText, iterState)
    if (iters !== lastReportedIters) {
      lastReportedIters = iters
      onStatus({ itersSinceLastChange: iters })
    }

    if (!iterState.inOptimization) return
    for (const line of lines) {
      const values = line.trim().split(/\s+/)
      if (values.length < 4 || !/^\d+$/.test(values[0]) || !/^\d+$/.test(values[1])) continue
      const convergence = Number(values.at(-2))
      const seconds = Number(values.at(-1))
      if (!Number.isFinite(convergence) || !Number.isFinite(seconds) || convergence === lastReportedConvergence) continue
      lastReportedConvergence = convergence
      onStatus({ convergencePercent: convergence })
    }
  }
}

// Called once at startup — runs tasklist to get a reliable snapshot of all running PIDs.
export function getRunningPidSet(): Set<number> {
  const pids = new Set<number>()
  try {
    const result = spawnSync('tasklist', ['/NH', '/FO', 'CSV'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000
    })
    if (!result.error && result.status === 0) {
      for (const line of (result.stdout as string).split(/\r?\n/)) {
        const match = line.match(/^"[^"]+","(\d+)"/)
        if (match) pids.add(Number(match[1]))
      }
    }
  } catch { /* ignore */ }
  return pids
}

// Used by completion pollers — fast per-PID check (non-blocking).
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') return true
    return false
  }
}

function readConsoleLog(outputDir: string): string {
  const consolePath = path.join(outputDir, 'Console.txt')
  if (!fs.existsSync(consolePath)) return ''

  try {
    return fs.readFileSync(consolePath, 'utf8')
  } catch {
    return ''
  }
}

function findConsoleLogPath(outputDir: string, exeDir: string): string | undefined {
  const outputConsolePath = path.join(outputDir, 'Console.txt')
  if (fs.existsSync(outputConsolePath)) return outputConsolePath

  const exeConsolePath = path.join(exeDir, 'Console.txt')
  if (fs.existsSync(exeConsolePath)) return exeConsolePath

  return undefined
}

function readFileSlice(filePath: string, start: number): { text: string; position: number } {
  const stats = fs.statSync(filePath)
  const position = stats.size
  if (position <= start) return { text: '', position }

  const buffer = Buffer.alloc(position - start)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buffer, 0, buffer.length, start)
  } finally {
    fs.closeSync(fd)
  }

  return { text: buffer.toString('utf8'), position }
}

function startConsoleLogStreaming(
  jobId: string,
  outputDir: string,
  exeDir: string,
  sendLog: (text: string) => void,
  handleStageText: (text: string) => void
): void {
  let consolePath: string | undefined
  let position = 0

  const poller = setInterval(() => {
    try {
      const activeConsolePath = findConsoleLogPath(outputDir, exeDir)
      if (!activeConsolePath) return

      if (activeConsolePath !== consolePath) {
        consolePath = activeConsolePath
        position = 0
        sendLog(`[Orchestrator] Streaming ${consolePath}\n`)
      }

      const slice = readFileSlice(consolePath, position)
      position = slice.position
      if (slice.text) {
        handleStageText(slice.text)
        sendLog(slice.text)
      }
    } catch {
      // MateSel can briefly lock Console.txt while writing it. Try again on the next poll.
    }
  }, CONSOLE_POLL_INTERVAL_MS)

  consolePollers.set(jobId, poller)
}

function stopConsoleLogStreaming(jobId: string): void {
  const poller = consolePollers.get(jobId)
  if (!poller) return

  clearInterval(poller)
  consolePollers.delete(jobId)
}

function stopCompletionPolling(jobId: string): void {
  const poller = completionPollers.get(jobId)
  if (!poller) return

  clearInterval(poller)
  completionPollers.delete(jobId)
}

function saveConsoleLogToJobFolder(outputDir: string, jobFolder: string, fallbackText: string): void {
  if (path.resolve(outputDir) === path.resolve(jobFolder)) return

  const outputConsolePath = path.join(outputDir, 'Console.txt')
  const jobConsolePath = path.join(jobFolder, 'Console.txt')

  if (fs.existsSync(outputConsolePath)) {
    fs.copyFileSync(outputConsolePath, jobConsolePath)
    return
  }

  if (fallbackText.trim()) {
    fs.writeFileSync(jobConsolePath, fallbackText)
  }
}
function toSpaceSafePath(filePath: string): string {
  if (!filePath.includes(' ')) return filePath

  // Resolve the 8.3 name via PowerShell's FileSystemObject. The path is passed
  // through an env var rather than embedded in the command string: cmd.exe
  // mangles the backslash-escaped quotes Node adds around an inline path, which
  // is why a naive `cmd /c for ...` returns nothing here.
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFile($env:MATESEL_DATA_FILE).ShortPath'
      ],
      {
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, MATESEL_DATA_FILE: filePath }
      }
    )
    const shortPath = (result.stdout as string | undefined)?.trim()
    if (shortPath && !shortPath.includes(' ') && fs.existsSync(shortPath)) {
      return shortPath
    }
  } catch {
    /* fall through to the error below */
  }

  throw new Error(
    `MateSel cannot read a data file from a path with spaces, and no 8.3 short name ` +
      `is available for "${filePath}". Use an output folder without spaces in its path, ` +
      `or enable 8.3 short-name creation on the drive.`
  )
}

function ensureMateSelToken(exePath: string): void {
  const exeDir = path.dirname(exePath)
  if (!findFileNameCaseInsensitive(exeDir, 'RunToken.txt')) {
    throw new Error(`MateSel batch token not found. Put RunToken.txt beside ${exePath}.`)
  }
}

function minimizeProcessWindow(pid: number): void {
  const command = `
$signature = '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);'
Add-Type -MemberDefinition $signature -Name Win32ShowWindowAsync -Namespace Native
for ($i = 0; $i -lt 20; $i++) {
  $process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
  if ($process -and $process.MainWindowHandle -ne 0) {
    [Native.Win32ShowWindowAsync]::ShowWindowAsync($process.MainWindowHandle, 2) | Out-Null
    break
  }
  Start-Sleep -Milliseconds 250
}
`

  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command], {
    windowsHide: true,
    stdio: 'ignore'
  })
}

function startJob(
  jobFolder: string,
  jobId: string,
  outputDir: string,
  exePath: string,
  dataFileName: string | undefined,
  raisePriority: boolean,
  onComplete: JobCompleteCallback,
  onStatus: JobStatusCallback,
  onLog: JobLogCallback
): void {
  const preparedDataFileName = prepareMateSelDataFile(outputDir, dataFileName, onLog)
  const dataFilePath = toSpaceSafePath(path.join(outputDir, preparedDataFileName))
  const exeDir = path.dirname(exePath)

  const child = spawn(exePath, [dataFilePath], {
    cwd: exeDir,
    windowsHide: true,
    detached: true
  })
  child.unref()

  runningProcesses.set(jobId, child)

  if (child.pid) {
    applyPerformanceTuning(child.pid, raisePriority, onLog)
    minimizeProcessWindow(child.pid)
  }

  const handleStageText = createStageTextHandler(onStatus)

  onStatus({ status: 'running', startedAt: Date.now(), stage: null, pid: child.pid })

  let processOutput = ''
  const handleOutput = (data: Buffer): void => {
    const text = data.toString()
    processOutput += text
    handleStageText(text)
    onLog(text)
  }

  child.stdout?.on('data', handleOutput)
  child.stderr?.on('data', handleOutput)
  startConsoleLogStreaming(jobId, outputDir, exeDir, onLog, handleStageText)

  child.on('close', (code) => {
    runningProcesses.delete(jobId)
    stopConsoleLogStreaming(jobId)
    const exitCode = code ?? -1
    const consoleOutput = readConsoleLog(outputDir) || readConsoleLog(exeDir)
    const hasFatalOutput = hasFatalMateSelOutput(`${processOutput}\n${consoleOutput}`)
    const status = exitCode === 0 && !hasFatalOutput ? 'done' : 'failed'
    try {
      saveConsoleLogToJobFolder(outputDir, jobFolder, consoleOutput || processOutput)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      onLog(`[Orchestrator] Failed to save Console.txt to job folder: ${msg}\n`)
    }
    if (cancellingJobs.delete(jobId)) return

    if (hasFatalOutput) {
      onLog('[Orchestrator] MateSel reported a fatal error despite the process exit code.\n')
    }
    onStatus({ status, exitCode, finishedAt: Date.now(), stage: null })
    onComplete(jobId, status, exitCode)
  })

  child.on('error', (err) => {
    runningProcesses.delete(jobId)
    stopConsoleLogStreaming(jobId)
    if (cancellingJobs.delete(jobId)) return

    onLog(`[Orchestrator] Failed to start process: ${err.message}\n`)
    onStatus({ status: 'failed', exitCode: -1, finishedAt: Date.now(), stage: null })
    onComplete(jobId, 'failed', -1)
  })
}

export function prepareAndStart(
  win: BrowserWindow,
  jobFolder: string,
  outputDir: string,
  jobId: string,
  exePath: string,
  dataFileName: string | undefined,
  raisePriority: boolean,
  onComplete: JobCompleteCallback,
  onStatus?: JobStatusCallback,
  onLog?: JobLogCallback
): void {
  const sendStatus = onStatus ?? ((patch): void => {
    win.webContents.send(IPC.JOB_STATUS_UPDATE, { id: jobId, ...patch })
  })
  const sendLog = onLog ?? ((text): void => {
    win.webContents.send(IPC.JOB_LOG_CHUNK, { jobId, text })
  })

  try {
    if (path.resolve(jobFolder) !== path.resolve(outputDir)) {
      fs.cpSync(jobFolder, outputDir, { recursive: true, force: true })
    }
    ensureMateSelToken(exePath)
    startJob(jobFolder, jobId, outputDir, exePath, dataFileName, raisePriority, onComplete, sendStatus, sendLog)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    sendStatus({
      status: 'failed',
      exitCode: -1,
      finishedAt: Date.now(),
      stage: null
    })
    sendLog(`[Orchestrator] Setup error: ${msg}\n`)
    onComplete(jobId, 'failed', -1)
  }
}

export function reattachToRunningJob(
  jobId: string,
  pid: number,
  outputDir: string,
  jobFolder: string,
  exePath: string,
  onComplete: JobCompleteCallback,
  onStatus: JobStatusCallback,
  onLog: JobLogCallback
): void {
  const exeDir = path.dirname(exePath)
  orphanedPids.set(jobId, pid)

  const handleStageText = createStageTextHandler(onStatus)

  onLog(`[Orchestrator] Reconnected to running MateSel process (PID: ${pid}).\n`)
  startConsoleLogStreaming(jobId, outputDir, exeDir, onLog, handleStageText)

  const poller = setInterval(() => {
    if (isProcessAlive(pid)) return

    clearInterval(poller)
    completionPollers.delete(jobId)
    orphanedPids.delete(jobId)
    stopConsoleLogStreaming(jobId)

    const consoleOutput = readConsoleLog(outputDir) || readConsoleLog(exeDir)
    const hasFatalOutput = hasFatalMateSelOutput(consoleOutput)
    const status: 'failed' = 'failed'
    const exitCode = -1

    if (hasFatalOutput) {
      onLog('[Orchestrator] MateSel reported a fatal error.\n')
    } else {
      onLog(
        '[Orchestrator] Reattached MateSel process exited, but the original exit code is unavailable. Marking this job failed; review Console.txt and output files before treating it as complete.\n'
      )
    }
    try {
      saveConsoleLogToJobFolder(outputDir, jobFolder, consoleOutput)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      onLog(`[Orchestrator] Failed to save Console.txt to job folder: ${msg}\n`)
    }
    onStatus({ status, exitCode, finishedAt: Date.now(), stage: null })
    onComplete(jobId, status, exitCode)
  }, CONSOLE_POLL_INTERVAL_MS * 2)

  completionPollers.set(jobId, poller)
}

export function cancelProcess(jobId: string, stopExePath: string): void {
  cancellingJobs.add(jobId)
  stopCompletionPolling(jobId)

  const child = runningProcesses.get(jobId)
  if (!child) {
    const pid = orphanedPids.get(jobId)
    if (pid != null) {
      if (fs.existsSync(stopExePath)) {
        spawn(stopExePath, [], { windowsHide: true })
        setTimeout(() => {
          try { process.kill(pid) } catch { /* already gone */ }
        }, CANCEL_TIMEOUT_MS)
      } else {
        try { process.kill(pid) } catch { /* already gone */ }
      }
      orphanedPids.delete(jobId)
    }
    stopConsoleLogStreaming(jobId)
    cancellingJobs.delete(jobId)
    return
  }

  if (fs.existsSync(stopExePath)) {
    spawn(stopExePath, [], { windowsHide: true })
    const timeout = setTimeout(() => {
      if (runningProcesses.has(jobId)) child.kill()
    }, CANCEL_TIMEOUT_MS)
    child.once('close', () => {
      clearTimeout(timeout)
      stopConsoleLogStreaming(jobId)
    })
  } else {
    child.kill()
    stopConsoleLogStreaming(jobId)
  }
}
