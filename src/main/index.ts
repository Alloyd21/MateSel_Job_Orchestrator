import { app, BrowserWindow, session, shell } from 'electron'
import path from 'path'
import { init } from './jobQueue'
import { registerHandlers } from './ipc/handlers'

declare const __AUTO_UPDATE__: boolean

async function maybeInitAutoUpdates(window: BrowserWindow): Promise<void> {
  if (!__AUTO_UPDATE__) return
  const { initAutoUpdates } = await import('./updater')
  initAutoUpdates(window)
}

const localDevServerHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

const localRendererCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join('; ')

function openExternalUrl(url: string): void {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'mailto:') {
      shell.openExternal(url)
    }
  } catch {
    // Ignore malformed URLs from renderer-created windows.
  }
}

function isDevelopmentRendererUrl(url: string | undefined): url is string {
  if (!url || app.isPackaged) return false

  try {
    const parsedUrl = new URL(url)
    return (
      (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') &&
      localDevServerHosts.has(parsedUrl.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

function registerLocalRendererCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['file://*'] }, (details, callback) => {
    const responseHeaders = { ...(details.responseHeaders ?? {}) }
    for (const header of Object.keys(responseHeaders)) {
      if (header.toLowerCase() === 'content-security-policy') {
        delete responseHeaders[header]
      }
    }

    callback({
      responseHeaders: {
        ...responseHeaders,
        'Content-Security-Policy': [localRendererCsp]
      }
    })
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1841,
    height: 904,
    minWidth: 900,
    minHeight: 600,
    title: 'MateSel Orchestrator',
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDevelopmentRendererUrl(rendererUrl)) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerLocalRendererCsp()

  const win = createWindow()
  init(win)
  registerHandlers(win)
  void maybeInitAutoUpdates(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      init(w)
      registerHandlers(w)
      void maybeInitAutoUpdates(w)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
