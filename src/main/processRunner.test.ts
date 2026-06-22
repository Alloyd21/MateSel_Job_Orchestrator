import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStageTextHandler, reattachToRunningJob } from './processRunner'

let tempDir: string

function writeConsole(content: string): void {
  fs.writeFileSync(path.join(tempDir, 'Console.txt'), content)
}

function mockPidMissing(): void {
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    if (signal === 0) {
      const err = new Error(`Process ${pid} not found`) as NodeJS.ErrnoException
      err.code = 'ESRCH'
      throw err
    }
    return true
  }) as typeof process.kill)
}

beforeEach(() => {
  vi.useFakeTimers()
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-runner-'))
  mockPidMissing()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('reattachToRunningJob', () => {
  it('marks a disappeared reattached process failed when the exit code is unavailable', () => {
    writeConsole('FrontierDone\r\n')
    const onComplete = vi.fn()
    const onStatus = vi.fn()
    const onLog = vi.fn()

    reattachToRunningJob(
      'job-1',
      12345,
      tempDir,
      tempDir,
      path.join(tempDir, 'MateSel.exe'),
      onComplete,
      onStatus,
      onLog
    )

    vi.advanceTimersByTime(2000)

    expect(onComplete).toHaveBeenCalledWith('job-1', 'failed', -1)
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed', exitCode: -1, stage: null })
    )
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('original exit code is unavailable'))
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('review Console.txt and output files'))
  })

  it('preserves fatal console output as the reattach failure reason', () => {
    writeConsole('forrtl: severe (157): Program Exception - access violation\r\n')
    const onComplete = vi.fn()
    const onStatus = vi.fn()
    const onLog = vi.fn()

    reattachToRunningJob(
      'job-2',
      23456,
      tempDir,
      tempDir,
      path.join(tempDir, 'MateSel.exe'),
      onComplete,
      onStatus,
      onLog
    )

    vi.advanceTimersByTime(2000)

    expect(onComplete).toHaveBeenCalledWith('job-2', 'failed', -1)
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed', exitCode: -1, stage: null })
    )
    expect(onLog).toHaveBeenCalledWith('[Orchestrator] MateSel reported a fatal error.\n')
    expect(onLog).not.toHaveBeenCalledWith(expect.stringContaining('original exit code is unavailable'))
  })
})

describe('MateSel progress parsing', () => {
  it('reports the latest Conv% from complete and chunked optimization rows', () => {
    const onStatus = vi.fn()
    const handleText = createStageTextHandler(onStatus)

    handleText('FrontierDone = true\r\n  10 11 3 1.2 55.5 2.0\r\n  20 21       72')
    handleText('.25 3.0\r\n')

    expect(onStatus).toHaveBeenCalledWith({ convergencePercent: 55.5 })
    expect(onStatus).toHaveBeenLastCalledWith({ convergencePercent: 72.25 })
  })
})
