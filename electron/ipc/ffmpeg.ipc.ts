/**
 * FFmpeg IPC — Execute FFmpeg commands from Electron main process.
 */

import { spawn, ChildProcess } from 'child_process'
import { ipcMain, BrowserWindow, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Paths ──────────────────────────────────
function getResourcesRoot(): string {
    if (app.isPackaged) {
        return process.resourcesPath
    }
    // dev mode: __dirname = dist-electron/ → go up 1 level = project root
    return path.resolve(__dirname, '..')
}

export function getFFmpegPath(): string {
    const root = getResourcesRoot()
    const local = path.join(root, 'binaries', 'ffmpeg.exe')
    if (fs.existsSync(local)) return local
    return 'ffmpeg' // fallback to system FFmpeg
}

export function getFFprobePath(): string {
    const root = getResourcesRoot()
    const local = path.join(root, 'binaries', 'ffprobe.exe')
    if (fs.existsSync(local)) return local
    return 'ffprobe'
}

// ── Active processes ───────────────────────
const activeProcs = new Map<string, ChildProcess>()

// ── Probe: Get media info ──────────────────
async function probeFile(filePath: string): Promise<object> {
    return new Promise((resolve, reject) => {
        const args = [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath,
        ]

        const proc = spawn(getFFprobePath(), args, { windowsHide: true })
        let stdout = ''
        let stderr = ''

        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
            if (code === 0) {
                try { resolve(JSON.parse(stdout)) }
                catch { reject(new Error('Failed to parse ffprobe output')) }
            } else {
                reject(new Error(`ffprobe exit ${code}: ${stderr}`))
            }
        })
    })
}

// ── Remux: Re-encode with frequent keyframes for instant seeking ──
async function remuxForSeeking(inputPath: string): Promise<string> {
    const ext = path.extname(inputPath)
    const base = path.basename(inputPath, ext)
    const tmpDir = path.join(os.tmpdir(), 'aurasplit-preview')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const outPath = path.join(tmpDir, `${base}_preview${ext}`)

    // If already remuxed, reuse cached version
    if (fs.existsSync(outPath)) return outPath

    return new Promise((resolve, reject) => {
        const args = [
            '-y', '-i', inputPath,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '18',
            '-g', '30',            // keyframe every 30 frames (~0.5s at 60fps)
            '-keyint_min', '15',   // min keyframe interval
            '-c:a', 'copy',
            '-movflags', '+faststart',
            outPath,
        ]

        const proc = spawn(getFFmpegPath(), args, { windowsHide: true })
        let stderr = ''
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outPath)) {
                resolve(outPath)
            } else {
                reject(new Error(`Remux failed (${code}): ${stderr.slice(-200)}`))
            }
        })
    })
}

// ── Run: Execute FFmpeg command ────────────
function runFFmpeg(
    taskId: string,
    args: string[],
    win: BrowserWindow
): void {
    const proc = spawn(getFFmpegPath(), args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    })

    activeProcs.set(taskId, proc)

    proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim()
        if (text) {
            win.webContents.send(`ffmpeg:${taskId}`, {
                type: 'progress',
                message: text,
            })
        }
    })

    proc.on('close', (code) => {
        activeProcs.delete(taskId)
        win.webContents.send(`ffmpeg:${taskId}`, {
            type: 'exit',
            code,
        })
    })
}

// ── IPC Handlers ───────────────────────────
export function registerFFmpegIPC(): void {
    ipcMain.handle('ffmpeg:probe', async (_event, { filePath }) => {
        return probeFile(filePath)
    })

    ipcMain.handle('ffmpeg:run', async (event, { taskId, args }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { error: 'No window' }
        runFFmpeg(taskId, args, win)
        return { started: true, taskId }
    })

    ipcMain.handle('ffmpeg:stop', async (_event, { taskId }) => {
        const proc = activeProcs.get(taskId)
        if (proc) {
            proc.kill('SIGTERM')
            activeProcs.delete(taskId)
            return { stopped: true }
        }
        return { stopped: false }
    })

    ipcMain.handle('ffmpeg:paths', async () => {
        return {
            ffmpeg: getFFmpegPath(),
            ffprobe: getFFprobePath(),
        }
    })

    // Remux video with frequent keyframes for fast seeking in editor preview
    ipcMain.handle('ffmpeg:remux', async (_event, { filePath }) => {
        return remuxForSeeking(filePath)
    })
}
