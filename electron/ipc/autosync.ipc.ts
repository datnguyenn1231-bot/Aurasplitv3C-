/**
 * AutoSync IPC — AuraSplit v3
 *
 * New pipeline: WhisperX (Python) → words.json → aura_engine --mode autosync
 *
 * Flow:
 *   1. Spawn python_embed → whisper_worker.py → produces words.json
 *   2. Spawn aura_engine --mode autosync --config sync.json
 *   3. Engine reads words.json + script → match → cut → output clips
 *   4. Stream progress to UI
 */

import { ipcMain, BrowserWindow, app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

// ── Path Resolution (matches python.ipc.ts pattern) ──

function getAppRoot(): string {
    const appPath = app.getAppPath()
    return appPath.endsWith('dist') ? path.resolve(appPath, '..') : appPath
}

function getResourcesRoot(): string {
    if (app.isPackaged) {
        return process.resourcesPath
    }
    return getAppRoot()
}

function getPythonExe(): string | null {
    const resRoot = getResourcesRoot()
    const devRoot = getAppRoot()
    const exeDir = path.dirname(app.getPath('exe'))

    const candidates = [
        path.join(resRoot, 'python_embed', 'python.exe'),
        path.join(exeDir, 'python_embed', 'python.exe'),               // customer: extracted next to AuraSplit.exe
        path.join(devRoot, 'python_embed', 'python.exe'),
        path.join(devRoot, '..', 'python_embed', 'python.exe'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return null // Lite edition — python_embed not bundled
}

function getEnginePath(): string {
    const resRoot = getResourcesRoot()
    const devRoot = getAppRoot()
    const candidates = [
        path.join(resRoot, 'binaries', 'aura_engine.exe'),
        path.join(resRoot, 'engine', 'build', 'Release', 'aura_engine.exe'),
        path.join(devRoot, 'engine', 'build', 'Release', 'aura_engine.exe'),
        path.join(devRoot, 'engine', 'build', 'Debug', 'aura_engine.exe'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return ''
}

function getPythonWorkerPath(): string {
    const resRoot = getResourcesRoot()
    const devRoot = getAppRoot()
    const candidates = [
        path.join(resRoot, 'python', 'whisper_worker.py'),
        path.join(devRoot, 'python', 'whisper_worker.py'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return ''
}

function getFFmpegPath(): string {
    const resRoot = getResourcesRoot()
    const devRoot = getAppRoot()
    const candidates = [
        path.join(resRoot, 'binaries', 'ffmpeg.exe'),
        path.join(devRoot, 'binaries', 'ffmpeg.exe'),
        path.join(devRoot, '..', 'binaries', 'ffmpeg.exe'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return 'ffmpeg'
}

function getBinariesDir(): string {
    const resRoot = getResourcesRoot()
    const devRoot = getAppRoot()
    const candidates = [
        path.join(resRoot, 'binaries'),
        path.join(devRoot, 'binaries'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return ''
}

// ── Active Processes ─────────────────────────────

const activeProcesses = new Map<string, ChildProcess>()

function sendToRenderer(win: BrowserWindow, taskId: string, msg: any) {
    try {
        if (!win.isDestroyed()) {
            win.webContents.send(`autosync:${taskId}`, msg)
        }
    } catch { /* window closed */ }
}

// ── Persistent WhisperX Daemon ──
let whisperDaemon: ChildProcess | null = null

function ensureWhisperDaemon(): ChildProcess {
    if (whisperDaemon && !whisperDaemon.killed) {
        return whisperDaemon
    }

    const pythonExe = getPythonExe()
    if (!pythonExe) {
        throw new Error('⚠️ AutoSync cần python_embed (bản Full). Liên hệ admin để nhận bản Full.')
    }
    const workerScript = getPythonWorkerPath()
    if (!workerScript) throw new Error('whisper_worker.py not found')



    const proc = spawn(pythonExe, ['-u', workerScript, '--daemon'], {
        cwd: path.dirname(workerScript),
        env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    })

    proc.stderr?.on('data', () => {
        // Whisper stderr discarded — output goes to log file only
    })

    proc.on('close', () => {

        whisperDaemon = null
    })

    whisperDaemon = proc
    return proc
}

// Shutdown daemon on app quit
app.on('before-quit', () => {
    if (whisperDaemon && !whisperDaemon.killed) {
        try {
            whisperDaemon.stdin?.write(JSON.stringify({ cmd: 'shutdown' }) + '\n')
            setTimeout(() => { whisperDaemon?.kill() }, 2000)
        } catch { whisperDaemon?.kill() }
    }
})

async function runWhisperX(
    config: Record<string, any>,
    taskId: string,
    win: BrowserWindow,
): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const daemon = ensureWhisperDaemon()

            const tmpDir = os.tmpdir()
            const outputPath = path.join(tmpDir, `autosync_words_${taskId}.json`)

            // Build transcription task
            const task = {
                cmd: 'transcribe',
                audio_path: config.audio_full_path,
                model_name: config.model_name || 'large-v3',
                device: 'cuda',
                compute_type: 'auto',
                lang_code: config.lang_code || null,
                fast_mode: config.fast_mode || false,
                model_cache_dir: config.model_cache_dir || path.join(getResourcesRoot(), 'models_ai'),
                output_path: outputPath,
                script_path: config.script_path || '',
            }
            console.error(`[IPC-DEBUG] daemon task script_path='${task.script_path}' config.script_path='${config.script_path}'`)

            sendToRenderer(win, taskId, {
                type: 'log', message: `🧠 WhisperX model: ${task.model_name} (daemon mode)`,
            })

            // Listen for result from daemon stdout
            const onData = (data: Buffer) => {
                const lines = data.toString('utf-8').split('\n').filter(Boolean)
                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed) continue
                    try {
                        const msg = JSON.parse(trimmed)
                        if (msg.type === 'result' && msg.output_path) {
                            // Transcription complete!
                            daemon.stdout?.off('data', onData)
                            resolve(msg.output_path)
                            return
                        }
                        if (msg.type === 'error') {
                            daemon.stdout?.off('data', onData)
                            reject(new Error(msg.message || 'WhisperX daemon error'))
                            return
                        }
                        // Forward logs to UI — skip verbose startup/internal messages
                        const m = msg.message || ''
                        const isVerbose = /Loading dependencies|PyTorch.*loaded|WhisperX loaded|Loading model|loaded and cached|GPU OOM|Model found locally|Model not found|Unloading previous|♻️|⬇️/.test(m)
                        if (!isVerbose) {
                            sendToRenderer(win, taskId, {
                                type: msg.type || 'log',
                                message: m || trimmed,
                                percent: msg.percent,
                                phase: 'whisper',
                            })
                        }
                    } catch {
                        // Only forward [WHISPER] prefixed lines, skip verbose Python logging
                        if (trimmed.startsWith('[WHISPER]')) {
                            sendToRenderer(win, taskId, {
                                type: 'log', message: trimmed, phase: 'whisper',
                            })
                        }
                    }
                }
            }

            daemon.stdout?.on('data', onData)

            // Send task to daemon via stdin
            daemon.stdin?.write(JSON.stringify(task) + '\n')

        } catch (err: any) {
            reject(new Error(`WhisperX daemon failed: ${err.message}`))
        }
    })
}

// ── Step 2: Run Engine (autosync/autoimage/automixed) ──

async function runEngine(
    mode: string,
    engineConfig: Record<string, any>,
    taskId: string,
    win: BrowserWindow,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const enginePath = getEnginePath()
        if (!enginePath) {
            return reject(new Error('aura_engine.exe not found'))
        }

        // Write engine config
        const tmpDir = os.tmpdir()
        const configPath = path.join(tmpDir, `engine_config_${taskId}.json`)
        fs.writeFileSync(configPath, JSON.stringify(engineConfig), 'utf-8')



        const binDir = getBinariesDir()
        // Create fontconfig (matches reup.ipc.ts pattern — prevents engine crash)
        const fontsDir = path.join(binDir, '..', '..', 'fonts')
        const fontconfPath = path.join(tmpDir, 'aura_fonts.conf')
        if (!fs.existsSync(fontconfPath)) {
            const winFonts = 'C:/Windows/Fonts'
            fs.writeFileSync(fontconfPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${winFonts}</dir>
  <dir>${fontsDir.replace(/\\/g, '/')}</dir>
  <cachedir>${tmpDir.replace(/\\/g, '/')}/fontconfig-cache</cachedir>
</fontconfig>`, 'utf-8')
        }


        const proc = spawn(enginePath, ['--mode', mode, '--config', configPath], {
            windowsHide: true,
            cwd: binDir || undefined,
            env: {
                ...process.env,
                PATH: binDir ? `${binDir};${process.env.PATH}` : process.env.PATH,
                FONTCONFIG_FILE: fontconfPath,
                FONTCONFIG_PATH: path.dirname(fontconfPath),
            },
        })

        activeProcesses.set(taskId + '_engine', proc)

        // Parse JSON progress from stdout
        let buffer = ''
        proc.stdout?.on('data', (data: Buffer) => {
            buffer += data.toString('utf-8')
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed) continue
                try {
                    const msg = JSON.parse(trimmed)
                    sendToRenderer(win, taskId, {
                        type: msg.done ? (msg.success ? 'result' : 'error') : msg.log ? 'log' : 'progress',
                        message: msg.log || msg.error || '',
                        percent: msg.progress ? Math.round(msg.progress * 100) : undefined,
                        phase: 'engine',
                        data: msg,
                    })
                } catch {
                    sendToRenderer(win, taskId, {
                        type: 'log', message: trimmed, phase: 'engine',
                    })
                }
            }
        })

        proc.stderr?.on('data', (data: Buffer) => {
            const text = data.toString('utf-8').trim()
            if (!text) return
            // Filter out CUDA noise and garbage encoding
            for (const line of text.split('\n')) {
                const t = line.trim()
                if (!t) continue
                // Skip CUDA init noise, encoding garbage, verbose FFmpeg
                if (/^\[CUDA\]|^Ã|^\[NVENC\]|processImage DONE/.test(t)) continue
                sendToRenderer(win, taskId, {
                    type: 'log', message: t, phase: 'engine',
                })
            }
        })

        proc.on('close', (code) => {
            activeProcesses.delete(taskId + '_engine')
            sendToRenderer(win, taskId, {
                type: 'exit', code,
            })
            if (code === 0) resolve()
            else reject(new Error(`Engine exited with code ${code}`))
        })
    })
}

// ── IPC Registration ─────────────────────────────

export function registerAutoSyncIPC(): void {

    // Main handler: run full autosync pipeline
    ipcMain.handle('autosync:run', async (event, { taskId, config, mode }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { started: false, error: 'No window' }

        const syncMode = mode || 'autosync' // autosync | autoimage | automixed


        sendToRenderer(win, taskId, {
            type: 'log', message: `🚀 Starting ${syncMode} pipeline...`,
        })

        // Run async pipeline in background
        ;(async () => {
            try {
                // Phase 1: WhisperX transcription (unless SRT mode)
                const isSRT = config.script_path?.toLowerCase().endsWith('.srt')
                let wordsJsonPath = ''

                if (!isSRT) {
                    sendToRenderer(win, taskId, {
                        type: 'progress', message: '🧠 AI Transcription...', percent: 5,
                    })
                    wordsJsonPath = await runWhisperX(config, taskId, win)
                    sendToRenderer(win, taskId, {
                        type: 'log', message: '✅ WhisperX done → ' + wordsJsonPath,
                    })
                } else {
                    sendToRenderer(win, taskId, {
                        type: 'log', message: '📝 SRT mode → skip WhisperX',
                    })
                }

                // Phase 2: Engine matching + cutting
                sendToRenderer(win, taskId, {
                    type: 'progress', message: '✂️ Matching and cutting...', percent: 30,
                })

                const ffmpegPath = getFFmpegPath()
                const ffprobePath = ffmpegPath.replace('ffmpeg.exe', 'ffprobe.exe')
                // automixed: media_source_dir → both video + image dirs
                const mediaDir = config.media_source_dir || ''
                const binDir = getBinariesDir()
                const engineConfig = {
                    audio_path: config.audio_full_path,
                    script_path: config.script_path,
                    words_json_path: wordsJsonPath,
                    video_source_dir: config.video_source_dir || mediaDir,
                    image_source_dir: config.image_source_dir || mediaDir,
                    output_dir: config.output_dir,
                    ffmpeg_path: ffmpegPath,
                    ffprobe_path: ffprobePath,
                    binaries_dir: binDir,
                    effect_type: config.effect_type || 'kenburns',
                    canvas_width: config.canvas_width || 1080,
                    canvas_height: config.canvas_height || 1920,
                }

                await runEngine(syncMode, engineConfig, taskId, win)

                sendToRenderer(win, taskId, {
                    type: 'result', message: '✅ Pipeline completed!',
                })
            } catch (error: any) {
                console.error('[AUTOSYNC] Pipeline error:', error)
                sendToRenderer(win, taskId, {
                    type: 'error', message: error.message || String(error),
                })
                sendToRenderer(win, taskId, {
                    type: 'exit', code: 1,
                })
            }
        })()

        return { started: true, taskId }
    })

    // Stop handler
    ipcMain.handle('autosync:stop', async (_event, { taskId }) => {
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
