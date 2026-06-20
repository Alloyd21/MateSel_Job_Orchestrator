import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateReadyPayload } from '../shared'
import { IPC } from './ipc/channels'
import { hasActiveJobs, onQueueActivityChange } from './jobQueue'

let win: BrowserWindow | null = null
let registered = false
let updateReady = false
let updateVersion: string | null = null

function logUpdaterError(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  console.warn(`[Updater] ${message}: ${detail}`)
}

function notifyUpdateReadyIfIdle(): void {
  if (!updateReady || hasActiveJobs() || !win || win.isDestroyed()) return

  const payload: UpdateReadyPayload = { version: updateVersion }
  win.webContents.send(IPC.UPDATE_READY, payload)
}

function checkForUpdatesAfterLaunch(): void {
  if (!app.isPackaged) return

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      logUpdaterError('Update check failed', error)
    })
  }, 3000)
}

export function initAutoUpdates(mainWindow: BrowserWindow): void {
  win = mainWindow

  if (!registered) {
    registered = true
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('update-downloaded', (info) => {
      updateReady = true
      updateVersion = info.version ?? null
      notifyUpdateReadyIfIdle()
    })

    autoUpdater.on('error', (error) => {
      logUpdaterError('Updater error', error)
    })

    onQueueActivityChange(() => {
      notifyUpdateReadyIfIdle()
    })

    ipcMain.handle(IPC.UPDATE_INSTALL_AND_RESTART, () => {
      if (!updateReady) return { ready: false }

      autoUpdater.quitAndInstall(false, true)
      return { ready: true }
    })

    checkForUpdatesAfterLaunch()
  }

  notifyUpdateReadyIfIdle()
}
