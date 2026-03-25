/**
 * Preload script — expose IPC bridge to renderer.
 * Renderer CANNOT directly access Node.js APIs (security).
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── License ──
  licenseCheck: () =>
    ipcRenderer.invoke('license:check'),
  licenseActivate: (key: string) =>
    ipcRenderer.invoke('license:activate', { key }),
  licenseDeactivate: () =>
    ipcRenderer.invoke('license:deactivate'),
  licenseHWID: () =>
    ipcRenderer.invoke('license:hwid'),

  // ── Python IPC ──
  runPython: (taskId: string, taskType: string, config: object) =>
    ipcRenderer.invoke('python:run', { taskId, taskType, config }),

  stopPython: (taskId: string) =>
    ipcRenderer.invoke('python:stop', { taskId }),

  pythonStatus: () =>
    ipcRenderer.invoke('python:status'),

  onPythonMessage: (taskId: string, callback: (msg: any) => void) => {
    const channel = `python:${taskId}`
    const handler = (_event: any, msg: any) => callback(msg)
    ipcRenderer.on(channel, handler)
    // Return cleanup function
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // ── AutoSync IPC (v3 pipeline) ──
  runAutoSync: (taskId: string, mode: string, config: object) =>
    ipcRenderer.invoke('autosync:run', { taskId, config, mode }),

  stopAutoSync: (taskId: string) =>
    ipcRenderer.invoke('autosync:stop', { taskId }),

  onAutoSyncMessage: (taskId: string, callback: (msg: any) => void) => {
    const channel = `autosync:${taskId}`
    const handler = (_event: any, msg: any) => callback(msg)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // ── FFmpeg IPC ──
  probeFile: (filePath: string) =>
    ipcRenderer.invoke('ffmpeg:probe', { filePath }),

  runFFmpeg: (taskId: string, args: string[]) =>
    ipcRenderer.invoke('ffmpeg:run', { taskId, args }),

  stopFFmpeg: (taskId: string) =>
    ipcRenderer.invoke('ffmpeg:stop', { taskId }),

  ffmpegPaths: () =>
    ipcRenderer.invoke('ffmpeg:paths'),

  remuxForSeeking: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('ffmpeg:remux', { filePath }),

  onFFmpegMessage: (taskId: string, callback: (msg: any) => void) => {
    const channel = `ffmpeg:${taskId}`
    const handler = (_event: any, msg: any) => callback(msg)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // ── Dialog ──
  selectFiles: (options: object) =>
    ipcRenderer.invoke('dialog:selectFiles', options),

  selectFolder: () =>
    ipcRenderer.invoke('dialog:selectFolder'),

  saveFile: (options: { title?: string; defaultPath?: string; filters?: any[]; content: string }) =>
    ipcRenderer.invoke('dialog:saveFile', options),

  selectSavePath: (options: { title?: string; defaultPath?: string; filters?: any[] }) =>
    ipcRenderer.invoke('dialog:selectSavePath', options),

  // ── Media ──
  getMediaUrl: (filePath: string) =>
    ipcRenderer.invoke('media:getUrl', filePath),
  readMediaFile: (filePath: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('media:readFile', filePath),

  // ── File System ──
  readFile: (filePath: string) =>
    ipcRenderer.invoke('fs:readFile', filePath),

  scanFolder: (dirPath: string) =>
    ipcRenderer.invoke('fs:scanFolder', dirPath),

  batchRename: (dirPath: string, mode?: string) =>
    ipcRenderer.invoke('fs:batchRename', dirPath, mode),

  // ── Shell ──
  openFolder: (folderPath: string) =>
    ipcRenderer.invoke('shell:openPath', folderPath),

  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke('shell:showItemInFolder', filePath),

  // ── Merge (SK2) ──
  mergeScan: (folderPath: string) =>
    ipcRenderer.invoke('merge:scan', { folderPath }),

  mergeRun: (config: object) =>
    ipcRenderer.invoke('merge:run', { config }),

  mergeStop: () =>
    ipcRenderer.invoke('merge:stop'),

  onMergeLog: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg)
    ipcRenderer.on('merge:log', handler)
    return () => ipcRenderer.removeListener('merge:log', handler)
  },

  // ── Reup ──
  reupScan: (folderPath: string) =>
    ipcRenderer.invoke('reup:scan', { folderPath }),

  reupRun: (config: object) =>
    ipcRenderer.invoke('reup:run', { config }),

  reupStop: () =>
    ipcRenderer.invoke('reup:stop'),

  reupExport: (config: object, outputPath?: string) =>
    ipcRenderer.invoke('reup:export', { config, outputPath }),

  reupAutoPipeline: (opts: { folderPath?: string; outputDir?: string; baseConfig: object; inputPath?: string; splitDuration?: number }) =>
    ipcRenderer.invoke('reup:autoPipeline', opts),

  reupShufflePipeline: (opts: { parentFolder: string; targetDuration: number; deleteOriginals: boolean; baseConfig: object }) =>
    ipcRenderer.invoke('reup:shufflePipeline', opts),

  onReupLog: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg)
    ipcRenderer.on('reup:log', handler)
    return () => ipcRenderer.removeListener('reup:log', handler)
  },

  onReupLogReplace: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg)
    ipcRenderer.on('reup:logReplace', handler)
    return () => ipcRenderer.removeListener('reup:logReplace', handler)
  },

  // ── Split Part ──
  splitScanFolder: (folderPath: string) =>
    ipcRenderer.invoke('split:scanFolder', { folderPath }),

  splitRun: (inputPath: string, splitDuration: number, showTitle: boolean, showPart: boolean) =>
    ipcRenderer.invoke('split:run', { inputPath, splitDuration, showTitle, showPart }),

  splitGetDuration: (filePath: string) =>
    ipcRenderer.invoke('split:getDuration', { filePath }),

  // ── V2Image ──
  runV2Image: (taskId: string, config: object) =>
    ipcRenderer.invoke('v2image:run', { taskId, config }),

  stopV2Image: (taskId: string) =>
    ipcRenderer.invoke('v2image:stop', { taskId }),

  onV2ImageMessage: (taskId: string, callback: (msg: any) => void) => {
    const channel = `v2image:${taskId}`
    const handler = (_event: any, msg: any) => callback(msg)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // ── Generic helpers ──
  invoke: (channel: string, ...args: any[]) =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
