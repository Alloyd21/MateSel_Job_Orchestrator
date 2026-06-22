import { app, ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AddJobRequest, AddJobResult, BatchGeneratePayload } from '../../shared'
import { IPC } from './channels'
import { store } from '../store'
import { enqueue, cancel, cancelAll, clearCompleted, getAllJobs, restartFailed, start, startAll } from '../jobQueue'
import { deleteOutputFiles, discoverJobFolders, listOutputFiles, validateJobFolder } from '../fileManager'
import { generateBatchJobs, inspectBatchStarter } from '../batchGenerator'
import { logicalProcessors, maxConcurrentJobs } from '../systemCapacity'

export function registerHandlers(win: BrowserWindow): void {
  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IPC.JOBS_GET_ALL, () => getAllJobs())

  ipcMain.handle(IPC.BATCH_INSPECT_STARTER, (_event, starterFolder: string) => {
    return inspectBatchStarter(starterFolder)
  })

  ipcMain.handle(IPC.BATCH_GENERATE, (_event, payload: BatchGeneratePayload) => {
    const result = generateBatchJobs(payload)
    for (const folder of result.generatedFolders) {
      enqueue(folder, result.dataFileName)
    }
    return result
  })

  ipcMain.handle(IPC.JOB_ADD, async (_event, jobRequests: Array<string | AddJobRequest>) => {
    const requests = jobRequests.map((request) => typeof request === 'string' ? { folder: request } : request)
    const foldersWithoutExplicitDataFile = requests
      .filter((request) => !request.dataFileName)
      .map((request) => request.folder)
    const explicitRequests = requests.filter((request): request is AddJobRequest & { dataFileName: string } =>
      Boolean(request.dataFileName)
    )
    const discoveredFolders = discoverJobFolders(foldersWithoutExplicitDataFile)
    const foldersToQueue: AddJobRequest[] = [
      ...explicitRequests,
      ...(discoveredFolders.length > 0 ? discoveredFolders : foldersWithoutExplicitDataFile).map((folder) => ({
        folder
      }))
    ]
    const jobs = foldersToQueue.map(({ folder, dataFileName }) => {
      const validation = dataFileName ? { valid: true, warnings: [] } : validateJobFolder(folder)
      return { folder, dataFileName, validation }
    })
    const foldersWithOutput = jobs
      .filter(({ validation }) => validation.valid)
      .map(({ folder }) => folder)
      .filter((folder) => listOutputFiles(folder).length > 0)
    const deleteExistingOutput = requests.length > 0 && requests.every((request) => request.deleteExistingOutput)
    const results: AddJobResult[] = jobs.map(({ folder, validation }) => ({
      folder,
      ...validation,
      hasOutputFiles: !deleteExistingOutput && foldersWithOutput.includes(folder) || undefined
    }))

    if (foldersWithOutput.length > 0 && !deleteExistingOutput) return results
    if (foldersWithOutput.length > 0) deleteOutputFiles(foldersWithOutput)

    for (const { folder, dataFileName, validation } of jobs) {
      if (validation.valid) enqueue(folder, dataFileName)
    }
    return results
  })

  ipcMain.handle(IPC.JOB_CANCEL, (_event, jobId: string) => {
    cancel(jobId)
  })

  ipcMain.handle(IPC.JOB_CANCEL_ALL, () => {
    cancelAll()
  })

  ipcMain.handle(IPC.JOB_CLEAR_COMPLETED, (_event, includeReady = false) => {
    clearCompleted(includeReady)
  })

  ipcMain.handle(IPC.JOB_RESTART, (_event, jobId: string) => {
    restartFailed(jobId)
  })

  ipcMain.handle(IPC.JOB_START, (_event, jobId: string) => {
    start(jobId)
  })

  ipcMain.handle(IPC.JOB_START_ALL, () => {
    startAll()
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => store.store)

  ipcMain.handle(IPC.SYSTEM_CAPACITY_GET, () => ({ logicalProcessors, maxConcurrentJobs }))

  ipcMain.handle(IPC.SETTINGS_SET, (_event, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'maxConcurrent') {
        const requested = Number(value)
        if (Number.isFinite(requested)) {
          store.set(key, Math.min(maxConcurrentJobs, Math.max(1, Math.floor(requested))))
        }
      } else {
        store.set(key as never, value as never)
      }
    }
  })

  ipcMain.handle(IPC.DIALOG_OPEN_FOLDER, async (_event, discoverJobs = true) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled) return []

    if (!discoverJobs) return result.filePaths

    const discoveredFolders = discoverJobFolders(result.filePaths)
    return discoveredFolders.length > 0 ? discoveredFolders : result.filePaths
  })

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async (_event, filters: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.SHELL_OPEN_PATH, async (_event, targetPath: string) => {
    // This handler only ever opens local job/batch output directories. Restrict it to
    // existing local directories so a compromised renderer can't use shell.openPath's
    // ShellExecute semantics to launch arbitrary executables or trigger SMB auth to a
    // remote UNC host.
    if (typeof targetPath !== 'string') return 'Refused: invalid path'

    const resolved = path.resolve(targetPath)
    if (resolved.startsWith('\\\\')) return 'Refused: network path'

    try {
      if (!fs.statSync(resolved).isDirectory()) return 'Refused: not a directory'
    } catch {
      return 'Refused: path does not exist'
    }

    return shell.openPath(resolved)
  })
}
