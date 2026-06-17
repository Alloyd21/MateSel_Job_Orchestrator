import { app, ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { IPC } from './channels'
import { store } from '../store'
import { enqueue, cancel, cancelAll, clearCompleted, getAllJobs, restartFailed, start, startAll } from '../jobQueue'
import { discoverJobFolders, validateJobFolder } from '../fileManager'
import { generateBatchJobs, inspectBatchStarter, type BatchVariationSpec } from '../batchGenerator'

interface AddJobRequest {
  folder: string
  dataFileName?: string
}

interface AddJobResult {
  folder: string
  valid: boolean
  warnings: string[]
  needsDataFile?: boolean
  files?: string[]
}

interface BatchGeneratePayload {
  starterFolder: string
  destinationParent: string
  selectedDataFileName?: string
  variations: BatchVariationSpec[]
  allowLargeBatch?: boolean
}

function normalizeAddJobRequest(request: string | AddJobRequest): AddJobRequest {
  return typeof request === 'string' ? { folder: request } : request
}

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

  ipcMain.handle(IPC.JOB_ADD, (_event, jobRequests: Array<string | AddJobRequest>) => {
    const requests = jobRequests.map(normalizeAddJobRequest)
    const foldersWithoutExplicitDataFile = requests
      .filter((request) => !request.dataFileName)
      .map((request) => request.folder)
    const explicitRequests = requests.filter((request): request is Required<AddJobRequest> =>
      Boolean(request.dataFileName)
    )
    const results: AddJobResult[] = []
    const discoveredFolders = discoverJobFolders(foldersWithoutExplicitDataFile)
    const foldersToQueue: AddJobRequest[] = [
      ...explicitRequests,
      ...(discoveredFolders.length > 0 ? discoveredFolders : foldersWithoutExplicitDataFile).map((folder) => ({
        folder
      }))
    ]

    for (const { folder, dataFileName } of foldersToQueue) {
      const validation = dataFileName ? { valid: true, warnings: [] } : validateJobFolder(folder)
      results.push({ folder, ...validation })
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

  ipcMain.handle(IPC.JOB_CLEAR_COMPLETED, () => {
    clearCompleted()
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

  ipcMain.handle(IPC.SETTINGS_SET, (_event, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      store.set(key as never, value as never)
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
    return shell.openPath(targetPath)
  })
}
