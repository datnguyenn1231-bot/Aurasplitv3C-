import { app, BrowserWindow, dialog, ipcMain, shell, protocol, net } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { registerPythonIPC } from './ipc/python.ipc'
import { registerAutoSyncIPC } from './ipc/autosync.ipc'
import { registerFFmpegIPC } from './ipc/ffmpeg.ipc'
import { registerMergeIPC } from './ipc/merge.ipc'
import { registerReupIPC } from './ipc/reup.ipc'
import { registerV2ImageIPC } from './ipc/v2image.ipc'
import { registerLicenseIPC, startHeartbeat } from './ipc/license.ipc'
import { initAntiDebug } from './security/antiDebug'
import { checkIntegrity } from './security/integrity'
import fs from 'node:fs'
import crypto from 'node:crypto'

// Register custom protocol scheme (must be before app.ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,        // critical for video streaming/seeking
      bypassCSP: true,
    },
  },
])

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// ── Global Safety Net — prevent silent crashes on user machines ──
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  dialog.showErrorBox('AuraSplit — Lỗi không mong muốn', `${msg}\n\nVui lòng chụp ảnh và gửi cho dev.`)
})
process.on('uncaughtException', (err) => {
  dialog.showErrorBox('AuraSplit — Lỗi nghiêm trọng', `${err.message}\n\nVui lòng khởi động lại app.`)
})

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'AuraSplit v2',
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#18181f',
      symbolColor: '#8b8ba0',
      height: 36
    },
    backgroundColor: '#14141a',
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  // Prevent Electron from opening dropped files as navigation
  // This allows the Vue drop zone to handle drag-and-drop properly
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function registerDialogIPC() {
  ipcMain.handle('dialog:selectFiles', async (_event, options: any) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: options?.filters || [],
      title: options?.title || 'Select Files',
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Folder',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Save file with content — shows "Save As" dialog then writes
  ipcMain.handle('dialog:saveFile', async (_event, options: { title?: string; defaultPath?: string; filters?: any[]; content: string }) => {
    const result = await dialog.showSaveDialog({
      title: options.title || 'Save File',
      defaultPath: options.defaultPath || '',
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, options.content, 'utf-8')
    return result.filePath
  })

  // Select save path only — shows "Save As" dialog, returns path WITHOUT writing
  ipcMain.handle('dialog:selectSavePath', async (_event, options: { title?: string; defaultPath?: string; filters?: any[] }) => {
    const result = await dialog.showSaveDialog({
      title: options.title || 'Save As',
      defaultPath: options.defaultPath || '',
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })
}

function registerFsIPC() {
  // Read text file content (for script preview)
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch { return '' }
  })

  // Scan folder → list files AND subdirectories (for drop zone auto-detect)
  ipcMain.handle('fs:scanFolder', async (_event, dirPath: string) => {
    try {
      if (!fs.statSync(dirPath).isDirectory()) return { files: [], dirs: [] }
      const entries = fs.readdirSync(dirPath)
      const files: string[] = []
      const dirs: string[] = []
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry)
        const stat = fs.statSync(fullPath)
        if (stat.isFile()) files.push(fullPath)
        else if (stat.isDirectory()) dirs.push(fullPath)
      }
      return { files, dirs }
    } catch { return { files: [], dirs: [] } }
  })

  // Batch rename files in folder to 001, 002... (natural sort order)
  // mode: 'sequential' (default) | 'mixed' (odd=video, even=image, scans subfolders)
  ipcMain.handle('fs:batchRename', async (_event, dirPath: string, mode?: string) => {
    try {
      if (!fs.statSync(dirPath).isDirectory()) return { renamed: 0, error: 'Not a directory' }
      const videoExts = new Set(['.mp4','.mov','.mkv','.avi','.webm','.m4v','.flv'])
      const imageExts = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.webp','.tiff','.tif','.jfif','.heic'])
      const mediaExts = new Set([...videoExts, ...imageExts])

      const naturalSort = (a: string, b: string) => {
        const na = parseInt((path.basename(a).match(/\d+/) || ['999999'])[0])
        const nb = parseInt((path.basename(b).match(/\d+/) || ['999999'])[0])
        return na !== nb ? na - nb : a.localeCompare(b)
      }

      if (mode === 'mixed') {
        // Mixed mode: scan root + all subfolders for media files
        const allFiles: { fullPath: string; ext: string; isVideo: boolean }[] = []
        const scanDir = (dir: string) => {
          for (const f of fs.readdirSync(dir)) {
            const fp = path.join(dir, f)
            const stat = fs.statSync(fp)
            if (stat.isDirectory()) {
              scanDir(fp)  // recurse into subfolders
            } else if (stat.isFile()) {
              const ext = path.extname(f).toLowerCase()
              if (mediaExts.has(ext)) {
                allFiles.push({ fullPath: fp, ext, isVideo: videoExts.has(ext) })
              }
            }
          }
        }
        scanDir(dirPath)

        if (allFiles.length === 0) return { renamed: 0, error: 'No media files found (checked subfolders)' }

        // Separate and sort
        const videos = allFiles.filter(f => f.isVideo).sort((a, b) => naturalSort(a.fullPath, b.fullPath))
        const images = allFiles.filter(f => !f.isVideo).sort((a, b) => naturalSort(a.fullPath, b.fullPath))

        // Phase 1: move all to root with temp names
        const tempMap: { temp: string; ext: string; isVideo: boolean; orig: string }[] = []
        try {
          for (const f of [...videos, ...images]) {
            const tempName = `.__tmp__${crypto.randomUUID()}${f.ext}`
            fs.renameSync(f.fullPath, path.join(dirPath, tempName))
            tempMap.push({ temp: tempName, ext: f.ext, isVideo: f.isVideo, orig: f.fullPath })
          }
        } catch (e: any) {
          // Rollback
          for (const t of tempMap) {
            try { fs.renameSync(path.join(dirPath, t.temp), t.orig) } catch {}
          }
          return { renamed: 0, error: `Có file đang mở ở nơi khác, không thể đổi tên. Vui lòng tắt video đang xem. Lỗi: ${e.message}` }
        }

        // Phase 2: rename — videos odd (001,003...), images even (002,004...)
        const vids = tempMap.filter(t => t.isVideo)
        const imgs = tempMap.filter(t => !t.isVideo)
        let oddIdx = 1, evenIdx = 2

        for (const v of vids) {
          const newName = `${String(oddIdx).padStart(3, '0')}${v.ext}`
          fs.renameSync(path.join(dirPath, v.temp), path.join(dirPath, newName))
          oddIdx += 2
        }
        for (const img of imgs) {
          const newName = `${String(evenIdx).padStart(3, '0')}${img.ext}`
          fs.renameSync(path.join(dirPath, img.temp), path.join(dirPath, newName))
          evenIdx += 2
        }

        // Clean up empty subfolders
        for (const f of fs.readdirSync(dirPath)) {
          const fp = path.join(dirPath, f)
          try {
            if (fs.statSync(fp).isDirectory() && fs.readdirSync(fp).length === 0) {
              fs.rmdirSync(fp)
            }
          } catch { /* ignore */ }
        }

        return { renamed: tempMap.length, mode: 'mixed', videos: vids.length, images: imgs.length }
      } else {
        // Sequential mode: root-only scan, 001, 002, 003...
        const entries = fs.readdirSync(dirPath)
          .filter(f => {
            const ext = path.extname(f).toLowerCase()
            return fs.statSync(path.join(dirPath, f)).isFile() && mediaExts.has(ext)
          })
          .sort((a, b) => naturalSort(a, b))

        if (entries.length === 0) return { renamed: 0, error: 'No media files found' }

        const tempMap: { temp: string; ext: string; orig: string }[] = []
        try {
          for (const f of entries) {
            const ext = path.extname(f).toLowerCase()
            const tempName = `.__tmp__${crypto.randomUUID()}${ext}`
            fs.renameSync(path.join(dirPath, f), path.join(dirPath, tempName))
            tempMap.push({ temp: tempName, ext, orig: f })
          }
        } catch (e: any) {
          for (const t of tempMap) {
            try { fs.renameSync(path.join(dirPath, t.temp), path.join(dirPath, t.orig)) } catch {}
          }
          return { renamed: 0, error: `Có file đang mở ở nơi khác, không thể đổi tên. Vui lòng tắt video đang xem. Lỗi: ${e.message}` }
        }

        let idx = 1
        for (const { temp, ext } of tempMap) {
          const newName = `${String(idx).padStart(3, '0')}${ext}`
          fs.renameSync(path.join(dirPath, temp), path.join(dirPath, newName))
          idx++
        }
        return { renamed: tempMap.length }
      }
    } catch (e: any) {
      return { renamed: 0, error: e.message || String(e) }
    }
  })
}

app.whenReady().then(() => {
  // Register local-media:// protocol to serve local files to renderer
  protocol.handle('local-media', (request) => {
    // URL format: local-media://media/C:/path/to/file.mp4
    const url = new URL(request.url)
    let filePath = decodeURIComponent(url.pathname)
    // Remove leading slash on Windows (e.g., /C:/foo → C:/foo)
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }
    const fileUrl = pathToFileURL(filePath).toString()
    // Forward original request (including Range headers) for video streaming
    return net.fetch(fileUrl, {
      method: request.method,
      headers: request.headers,
    })
  })

  registerLicenseIPC()
  registerPythonIPC()
  registerAutoSyncIPC()
  registerFFmpegIPC()
  registerMergeIPC()
  registerReupIPC()
  registerV2ImageIPC()
  registerDialogIPC()
  registerFsIPC()
  startHeartbeat()

  // ── Security ──
  checkIntegrity()

  // Media: convert file path to streamable URL
  ipcMain.handle('media:getUrl', async (_event, filePath: string) => {
    const encoded = encodeURIComponent(filePath).replace(/%2F/g, '/').replace(/%3A/g, ':')
    return `local-media://media/${encoded}`
  })

  // Media: read file as binary buffer (for blob URL in renderer)
  ipcMain.handle('media:readFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath)
  })

  // Shell: open folder in Explorer
  ipcMain.handle('shell:openPath', async (_event, folderPath: string) => {
    return shell.openPath(folderPath)
  })

  // Shell: reveal file in Explorer
  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  createWindow()
  if (win) initAntiDebug(win)
})
