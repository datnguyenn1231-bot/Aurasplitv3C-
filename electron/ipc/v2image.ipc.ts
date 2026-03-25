/**
 * V2Image IPC — Video to Image Frame Extraction (AuraSplit v3)
 *
 * Extracts frames from video files as images using FFmpeg.
 * Supports batch processing (folder of videos).
 */

import { ipcMain, BrowserWindow, app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'node:path'
import fs from 'node:fs'

// ── FFmpeg Path (reuse from ffmpeg.ipc.ts) ──

function getAppRoot(): string {
    const appPath = app.getAppPath()
    return appPath.endsWith('dist') ? path.resolve(appPath, '..') : appPath
}

function getResourcesRoot(): string {
    return app.isPackaged ? process.resourcesPath : getAppRoot()
}

function getFFmpegPath(): string {
    const resRoot = getResourcesRoot()
    const devRoot = getAppRoot()
    const candidates = [
        path.join(resRoot, 'ffmpeg', 'ffmpeg.exe'),
        path.join(devRoot, 'ffmpeg', 'ffmpeg.exe'),
        path.join(devRoot, '..', 'ffmpeg', 'ffmpeg.exe'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return 'ffmpeg'
}

// ── Active Processes ──

const activeProcesses = new Map<string, ChildProcess>()

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.m4v'])

function sendToRenderer(win: BrowserWindow, taskId: string, msg: any) {
    try {
        if (!win.isDestroyed()) {
            win.webContents.send(`v2image:${taskId}`, msg)
        }
    } catch { /* window closed */ }
}

// ── Core: Extract frames from a single video ──

async function extractFrames(
    videoPath: string,
    outputDir: string,
    outputName: string,
    fps: number,
    format: string,
    quality: number,
    taskId: string,
    win: BrowserWindow,
    videoIndex: number,
    totalVideos: number,
): Promise<number> {
    return new Promise((resolve) => {
        const videoName = path.parse(videoPath).name
        // Always create subfolder: outputName for single, videoName for batch
        const folderName = totalVideos > 1 ? videoName : (outputName || videoName)
        const subDir = path.join(outputDir, folderName)
        fs.mkdirSync(subDir, { recursive: true })

        const ext = format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg'
        const outputPattern = path.join(subDir, `${videoName}_%04d.${ext}`)

        // Build FFmpeg args
        const args: string[] = [
            '-y', '-i', videoPath,
            '-vf', `fps=${fps}`,
        ]

        // Quality settings
        if (ext === 'jpg') {
            args.push('-q:v', String(Math.max(1, Math.min(31, Math.round((100 - quality) * 31 / 100)))))
        } else if (ext === 'png') {
            args.push('-compression_level', '3')
        } else if (ext === 'webp') {
            args.push('-quality', String(quality))
        }

        args.push('-loglevel', 'info', outputPattern)

        const label = totalVideos > 1
            ? `[${videoIndex + 1}/${totalVideos}] ${videoName}`
            : videoName

        sendToRenderer(win, taskId, {
            type: 'log', message: `🎬 Extracting: ${label} → fps=${fps}, format=${ext}`,
        })

        const ffmpegPath = getFFmpegPath()
        const proc = spawn(ffmpegPath, args, { windowsHide: true })
        activeProcesses.set(`${taskId}_${videoIndex}`, proc)

        let frameCount = 0

        // Parse FFmpeg stderr for progress
        proc.stderr?.on('data', (data: Buffer) => {
            const text = data.toString('utf-8')
            // Count frames from "frame=   X" pattern
            const frameMatch = text.match(/frame=\s*(\d+)/)
            if (frameMatch) {
                const currentFrame = parseInt(frameMatch[1])
                if (currentFrame > frameCount) {
                    frameCount = currentFrame
                    // Progress within this video
                    const videoProgress = (videoIndex / totalVideos + (1 / totalVideos) * 0.9) * 100
                    sendToRenderer(win, taskId, {
                        type: 'progress',
                        percent: Math.round(videoProgress),
                        message: `${label}: ${frameCount} frames extracted`,
                    })
                }
            }
        })

        proc.on('close', (code) => {
            activeProcesses.delete(`${taskId}_${videoIndex}`)
            if (code === 0) {
                // Count actual output files
                try {
                    const files = fs.readdirSync(subDir).filter(f => f.endsWith(`.${ext}`))
                    frameCount = files.length
                } catch { /* use frameCount from stderr */ }

                sendToRenderer(win, taskId, {
                    type: 'log', message: `✅ ${label}: ${frameCount} images saved`,
                })
                resolve(frameCount)
            } else {
                sendToRenderer(win, taskId, {
                    type: 'log', message: `❌ ${label}: FFmpeg error (code ${code})`,
                })
                resolve(0) // Don't reject — continue batch
            }
        })

        proc.on('error', (err) => {
            sendToRenderer(win, taskId, {
                type: 'log', message: `❌ ${label}: ${err.message}`,
            })
            resolve(0)
        })
    })
}

// ── IPC Registration ──

export function registerV2ImageIPC(): void {

    ipcMain.handle('v2image:run', async (event, { taskId, config }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { started: false, error: 'No window' }

        const {
            inputPath,
            outputDir,
            outputName = '',
            fps = 1,
            format = 'jpg',
            quality = 90,
        } = config

        if (!inputPath || !outputDir) {
            return { started: false, error: 'Missing input or output path' }
        }

        sendToRenderer(win, taskId, {
            type: 'log', message: '🚀 Video to Image — Starting...',
        })

        // Collect video files
        const videos: string[] = []
        const stat = fs.statSync(inputPath)
        if (stat.isDirectory()) {
            // Batch mode: scan folder
            const entries = fs.readdirSync(inputPath)
            for (const entry of entries) {
                const ext = path.extname(entry).toLowerCase()
                if (VIDEO_EXTS.has(ext)) {
                    videos.push(path.join(inputPath, entry))
                }
            }
            videos.sort()
        } else {
            videos.push(inputPath)
        }

        if (videos.length === 0) {
            sendToRenderer(win, taskId, {
                type: 'log', message: '❌ No video files found!',
            })
            return { started: false, error: 'No video files found' }
        }

        sendToRenderer(win, taskId, {
            type: 'log', message: `📂 Found ${videos.length} video(s) | fps=${fps} | format=${format}`,
        })

        // Process videos sequentially
        ;(async () => {
            let totalFrames = 0
            for (let i = 0; i < videos.length; i++) {
                const count = await extractFrames(
                    videos[i], outputDir, outputName, fps, format, quality,
                    taskId, win, i, videos.length,
                )
                totalFrames += count
            }

            sendToRenderer(win, taskId, {
                type: 'log', message: `🎉 Done! ${totalFrames} images from ${videos.length} video(s)`,
            })
            sendToRenderer(win, taskId, {
                type: 'progress', percent: 100, message: `✅ Complete — ${totalFrames} images`,
            })
            sendToRenderer(win, taskId, { type: 'done' })
        })()

        return { started: true, videoCount: videos.length }
    })

    ipcMain.handle('v2image:stop', async (_event, { taskId }) => {
        let killed = 0
        for (const [key, proc] of activeProcesses.entries()) {
            if (key.startsWith(taskId)) {
                try { proc.kill('SIGTERM') } catch { /* already dead */ }
                activeProcesses.delete(key)
                killed++
            }
        }
        return { stopped: killed > 0 }
    })
}
