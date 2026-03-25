/**
 * useAutoSync — Composable for SyncVideo/SyncImage/SyncMixed logic.
 * v1-compatible: CONFIG flow, drop zone auto-detect, script preview.
 */

import { ref, watch, nextTick, onUnmounted } from 'vue'
import { useEditor } from './useEditor'

// ── Types ──
interface SK1State {
    audioFile: string; scriptFile: string; videoDir: string; outputDir: string; outputName: string
    model: string; language: string
    running: boolean; progress: number; status: 'idle' | 'running' | 'done' | 'error'
    logs: string[]
}
interface SK3State {
    audioFile: string; scriptFile: string; imageDir: string; outputDir: string; outputName: string
    model: string; language: string
    running: boolean; progress: number; status: 'idle' | 'running' | 'done' | 'error'
    logs: string[]
}
interface SK3MState {
    audioFile: string; scriptFile: string; mediaDir: string; outputDir: string; outputName: string
    model: string; language: string; canvasSize: string
    running: boolean; progress: number; status: 'idle' | 'running' | 'done' | 'error'
    logs: string[]
}

// ── Constants (v1 MODEL_MAP) ──
export const WHISPER_MODELS = [
    { value: 'tiny', label: '⚡ LITE' },
    { value: 'base', label: '🔵 STARTER' },
    { value: 'small', label: '🟢 STANDARD' },
    { value: 'medium', label: '🔶 PRO' },
    { value: 'large-v3', label: '💎 PREMIUM' },
    { value: 'large-v3-turbo', label: '🚀 TURBO' },
]

export const LANGUAGES = [
    { value: 'auto', label: 'Auto Detect' },
    { value: 'vi', label: '🇻🇳 Vietnamese' },
    { value: 'en', label: '🇺🇸 English' },
    { value: 'ja', label: '🇯🇵 Japanese' },
    { value: 'ko', label: '🇰🇷 Korean' },
    { value: 'zh', label: '🇨🇳 Chinese' },
    { value: 'th', label: '🇹🇭 Thai' },
    { value: 'fr', label: '🇫🇷 French' },
    { value: 'de', label: '🇩🇪 German' },
    { value: 'es', label: '🇪🇸 Spanish' },
]

export const CANVAS_SIZES = [
    { value: '9:16', label: '📱 9:16 (Shorts/Reels)', width: 1080, height: 1920 },
    { value: '16:9', label: '🖥️ 16:9 (YouTube)', width: 1920, height: 1080 },
    { value: '1:1', label: '⬜ 1:1 (Square)', width: 1080, height: 1080 },
]

const AUDIO_EXT = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma']
const VIDEO_EXT = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv']
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif', 'tiff', 'jfif']

function ext(f: string) { return f.split('.').pop()?.toLowerCase() || '' }

// ── Composable ──
export function useAutoSync() {
    const activeTab = ref<'sk1' | 'sk3' | 'sk3m'>('sk1')
    const scriptContent = ref('')
    const dropHover = ref(false)
    const autoRename = ref(false)

    const sk1 = ref<SK1State>({
        audioFile: '', scriptFile: '', videoDir: '', outputDir: '', outputName: '',
        model: 'base', language: 'auto',
        running: false, progress: 0, status: 'idle', logs: [],
    })
    const sk3 = ref<SK3State>({
        audioFile: '', scriptFile: '', imageDir: '', outputDir: '', outputName: '',
        model: 'base', language: 'auto',
        running: false, progress: 0, status: 'idle', logs: [],
    })
    const sk3m = ref<SK3MState>({
        audioFile: '', scriptFile: '', mediaDir: '', outputDir: '', outputName: '',
        model: 'base', language: 'auto', canvasSize: '9:16',
        running: false, progress: 0, status: 'idle', logs: [],
    })

    let cleanupFn: (() => void) | null = null
    let activeTaskId: string | null = null

    function addLog(state: { value: { logs: string[] } }, msg: string) {
        if (msg?.trim()) {
            state.value.logs.push(msg)
            if (state.value.logs.length > 300) state.value.logs.shift()
            // Auto-scroll log panel to bottom
            nextTick(() => {
                const el = document.getElementById('systemLog')
                if (el) el.scrollTop = el.scrollHeight
            })
        }
    }

    // ── Load script content when scriptFile changes ──
    watch(() => sk1.value.scriptFile, async (path) => {
        if (path) scriptContent.value = await window.electronAPI.readFile?.(path) || ''
    })
    watch(() => sk3.value.scriptFile, async (path) => {
        if (path) scriptContent.value = await window.electronAPI.readFile?.(path) || ''
    })
    watch(() => sk3m.value.scriptFile, async (path) => {
        if (path) scriptContent.value = await window.electronAPI.readFile?.(path) || ''
    })

    // ── Drop Zone: smart auto-detect files + folders ──
    // Supports: .mp3/.wav→Audio, .txt/.srt→Script, folder→scan content
    async function handleDrop(e: DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        dropHover.value = false
        const items = e.dataTransfer?.files
        if (!items?.length) return

        const state = activeTab.value === 'sk1' ? sk1 : activeTab.value === 'sk3' ? sk3 : sk3m

        // Collect all dropped paths
        const droppedPaths: string[] = []
        for (let i = 0; i < items.length; i++) {
            const p = (items[i] as any).path as string
            if (p) droppedPaths.push(p)
        }
        if (!droppedPaths.length) return


        // ── Phase 1: Process each dropped item individually ──
        let foundAudio = '', foundScript = ''
        let foundVideoDir = '', foundImageDir = '', foundMediaDir = ''
        let lastFolderPath = ''

        for (const droppedPath of droppedPaths) {
            const e = ext(droppedPath)

            // ── Individual FILE detection ──
            if (AUDIO_EXT.includes(e)) {
                // .mp3, .wav, .flac, etc → Audio field
                foundAudio = droppedPath
                continue
            }
            if (e === 'txt' || e === 'srt') {
                // .txt, .srt → Script field
                foundScript = droppedPath
                continue
            }
            if (VIDEO_EXT.includes(e)) {
                // .mp4, .mkv → set parent folder as video source
                const parentDir = droppedPath.replace(/[\\/][^\\/]+$/, '')
                if (!foundVideoDir) foundVideoDir = parentDir
                continue
            }
            if (IMAGE_EXT.includes(e)) {
                // .jpg, .png → set parent folder as image source
                const parentDir = droppedPath.replace(/[\\/][^\\/]+$/, '')
                if (!foundImageDir) foundImageDir = parentDir
                continue
            }

            // ── FOLDER detection — check content directly ──
            const result = await window.electronAPI.scanFolder?.(droppedPath) as any
            if (!result) continue

            const files: string[] = result?.files || []
            lastFolderPath = droppedPath

            // Check files at root level for audio/script
            for (const f of files) {
                const fe = ext(f)
                if (!foundAudio && AUDIO_EXT.includes(fe)) foundAudio = f
                if (!foundScript && (fe === 'txt' || fe === 'srt')) foundScript = f
            }

            // Check if THIS folder contains videos/images directly
            const rootHasVids = files.some((f: string) => VIDEO_EXT.includes(ext(f)))
            const rootHasImgs = files.some((f: string) => IMAGE_EXT.includes(ext(f)) || ext(f) === 'jfif')
            if (rootHasVids && rootHasImgs) {
                if (!foundMediaDir) foundMediaDir = droppedPath
            } else if (rootHasVids) {
                if (!foundVideoDir) foundVideoDir = droppedPath
            } else if (rootHasImgs) {
                if (!foundImageDir) foundImageDir = droppedPath
            }
        }

        // ── Phase 2: If incomplete, try parent of first dropped path ──
        if ((!foundAudio || !foundScript) && droppedPaths.length === 1) {
            const parentDir = droppedPaths[0].replace(/[\\/][^\\/]+$/, '')
            const parentResult = await window.electronAPI.scanFolder?.(parentDir) as any
            if (parentResult?.files?.length) {
                for (const f of parentResult.files) {
                    const fe = ext(f)
                    if (!foundAudio && AUDIO_EXT.includes(fe)) foundAudio = f
                    if (!foundScript && (fe === 'txt' || fe === 'srt')) foundScript = f
                }
                if (foundAudio || foundScript) lastFolderPath = parentDir
            }
        }

        // ── Phase 3: Assign to state ──
        if (foundAudio) {
            state.value.audioFile = foundAudio
        }
        if (foundScript) {
            state.value.scriptFile = foundScript
        }

        if (activeTab.value === 'sk1') {
            if (foundVideoDir) sk1.value.videoDir = foundVideoDir
            else if (lastFolderPath && !sk1.value.videoDir) sk1.value.videoDir = lastFolderPath
        } else if (activeTab.value === 'sk3') {
            if (foundImageDir) sk3.value.imageDir = foundImageDir
            else if (lastFolderPath && !sk3.value.imageDir) sk3.value.imageDir = lastFolderPath
        } else if (activeTab.value === 'sk3m') {
            if (foundMediaDir) sk3m.value.mediaDir = foundMediaDir
            else if (foundVideoDir) sk3m.value.mediaDir = foundVideoDir
            else if (foundImageDir) sk3m.value.mediaDir = foundImageDir
            else if (lastFolderPath && !sk3m.value.mediaDir) sk3m.value.mediaDir = lastFolderPath
        }

        // Auto-set output directory
        if (!state.value.outputDir && lastFolderPath) {
            state.value.outputDir = lastFolderPath
        }

    }

    // ── File Pickers ──
    async function pickAudio(t: 'sk1' | 'sk3' | 'sk3m') {
        const files = await window.electronAPI.selectFiles({
            title: 'Select Audio / Video',
            filters: [{ name: 'Media', extensions: [...AUDIO_EXT, ...VIDEO_EXT] }],
        })
        if (files.length) (t === 'sk1' ? sk1 : t === 'sk3' ? sk3 : sk3m).value.audioFile = files[0]
    }
    async function pickScript(t: 'sk1' | 'sk3' | 'sk3m') {
        const files = await window.electronAPI.selectFiles({
            title: 'Select Script (.txt / .srt)',
            filters: [{ name: 'Script', extensions: ['txt', 'srt'] }],
        })
        if (files.length) (t === 'sk1' ? sk1 : t === 'sk3' ? sk3 : sk3m).value.scriptFile = files[0]
    }
    async function pickVideoDir() {
        const f = await window.electronAPI.selectFolder()
        if (f) sk1.value.videoDir = f
    }
    async function pickImageDir() {
        const f = await window.electronAPI.selectFolder()
        if (f) sk3.value.imageDir = f
    }
    async function pickMediaDir() {
        const f = await window.electronAPI.selectFolder()
        if (f) sk3m.value.mediaDir = f
    }
    async function pickOutputDir(t: 'sk1' | 'sk3' | 'sk3m') {
        const f = await window.electronAPI.selectFolder()
        if (f) (t === 'sk1' ? sk1 : t === 'sk3' ? sk3 : sk3m).value.outputDir = f
    }

    // ── Start / Stop ──
    async function startTask(taskType: 'sk1' | 'sk3' | 'sk3m') {
        const state = taskType === 'sk1' ? sk1 : taskType === 'sk3' ? sk3 : sk3m
        const taskId = `${taskType}_${Date.now()}`
        activeTaskId = taskId
        state.value.running = true; state.value.progress = 0
        state.value.status = 'running'; state.value.logs = []

        const finalOutput = state.value.outputName?.trim()
            ? `${state.value.outputDir}\\${state.value.outputName.trim()}`
            : state.value.outputDir

        // Map task type to engine mode
        const modeMap: Record<string, string> = {
            sk1: 'autosync',
            sk3: 'autoimage',
            sk3m: 'automixed',
        }
        const mode = modeMap[taskType]

        let config: Record<string, any>
        if (taskType === 'sk1') {
            config = {
                audio_full_path: sk1.value.audioFile, script_path: sk1.value.scriptFile,
                video_source_dir: sk1.value.videoDir, output_dir: finalOutput,
                model_name: sk1.value.model, lang_code: sk1.value.language,
            }
        } else if (taskType === 'sk3') {
            config = {
                audio_full_path: sk3.value.audioFile, script_path: sk3.value.scriptFile,
                image_source_dir: sk3.value.imageDir, output_dir: finalOutput,
                model_name: sk3.value.model, lang_code: sk3.value.language,
            }
        } else {
            const canvas = CANVAS_SIZES.find(c => c.value === sk3m.value.canvasSize) || CANVAS_SIZES[0]
            config = {
                audio_full_path: sk3m.value.audioFile, script_path: sk3m.value.scriptFile,
                media_source_dir: sk3m.value.mediaDir, output_dir: finalOutput,
                model_name: sk3m.value.model, lang_code: sk3m.value.language,
                canvas_width: canvas.width, canvas_height: canvas.height,
            }
        }

        // Cleanup previous listener to prevent leak when switching tabs
        cleanupFn?.()
        cleanupFn = null

        // Listen for AutoSync messages (v3 pipeline)
        cleanupFn = window.electronAPI.onAutoSyncMessage(taskId, (msg) => {
            if (msg.type === 'progress') {
                state.value.progress = msg.percent || 0
                if (msg.message) addLog(state, msg.message)
            } else if (msg.type === 'log') {
                addLog(state, msg.message || '')
            } else if (msg.type === 'stderr') {
                addLog(state, `⚠️ ${msg.message}`)
            } else if (msg.type === 'result') {
                state.value.status = 'done'; state.value.progress = 100
                addLog(state, msg.message || '✅ Completed!')
            } else if (msg.type === 'error') {
                state.value.status = 'error'
                addLog(state, `❌ ${msg.message}`)
            } else if (msg.type === 'exit') {
                state.value.running = false
                if (state.value.status === 'running') {
                    state.value.status = msg.code === 0 ? 'done' : 'error'
                    if (msg.code === 0) state.value.progress = 100
                }
            }
        })
        try {
            await window.electronAPI.runAutoSync(taskId, mode, config)
            addLog(state, `🚀 Task started: ${taskId}`)
        } catch (err: any) {
            state.value.running = false
            state.value.status = 'error'
            addLog(state, `❌ Failed to start: ${err.message || err}`)
        }
    }

    async function stopTask(t: 'sk1' | 'sk3' | 'sk3m') {
        const state = t === 'sk1' ? sk1 : t === 'sk3' ? sk3 : sk3m
        state.value.running = false
        state.value.status = 'idle'
        addLog(state, '🛑 Stopping...')
        // Kill the AutoSync process
        if (activeTaskId) {
            try {
                await window.electronAPI.stopAutoSync(activeTaskId)
                addLog(state, '🛑 Process killed.')
            } catch {
            }
            activeTaskId = null
        }
        cleanupFn?.()
        cleanupFn = null
    }

    function fileName(p: string) { return p.split(/[\\\/]/).pop() || p }
    function folderName(p: string) {
        return p.replace(/[\\\/]$/, '').split(/[\\\/]/).pop() || p
    }

    function clearFields() {
        const state = activeTab.value === 'sk1' ? sk1 : activeTab.value === 'sk3' ? sk3 : sk3m
        state.value.audioFile = ''
        state.value.scriptFile = ''
        state.value.outputDir = ''
        state.value.outputName = ''
        state.value.logs = []
        state.value.progress = 0
        state.value.status = 'idle'
        scriptContent.value = ''
        if (activeTab.value === 'sk1') sk1.value.videoDir = ''
        else if (activeTab.value === 'sk3') sk3.value.imageDir = ''
        else sk3m.value.mediaDir = ''
    }

    onUnmounted(() => cleanupFn?.())

    async function openOutputFolder(t: 'sk1' | 'sk3' | 'sk3m') {
        const dir = (t === 'sk1' ? sk1 : t === 'sk3' ? sk3 : sk3m).value.outputDir
        if (dir) {
            try {
                await (window as any).electronAPI.openFolder(dir)
            } catch (err: any) {
            }
        }
    }

    async function batchRenameFolder() {
        const dir = activeTab.value === 'sk1' ? sk1.value.videoDir
            : activeTab.value === 'sk3' ? sk3.value.imageDir
            : sk3m.value.mediaDir
        if (!dir) return
        const st = activeTab.value === 'sk1' ? sk1 : activeTab.value === 'sk3' ? sk3 : sk3m
        const mode = activeTab.value === 'sk3m' ? 'mixed' : undefined
        try {
            // UNLOCK FIX: Close active video player to force Chromium to release the OS-level file lock
            const editor = useEditor()
            if (editor.videoPath.value && editor.videoPath.value.includes(dir)) {
                addLog(st, `🔄 Closing preview player to release file lock...`)
                editor.closeVideo()
                await new Promise(r => setTimeout(r, 600)) // Wait for OS to flush lock
            }

            addLog(st, `🔄 Renaming files in: ${dir}${mode === 'mixed' ? ' (mixed: video=odd, image=even)' : ''}`)
            const result = await (window as any).electronAPI.batchRename(dir, mode)
            if (result.error) {
                addLog(st, `❌ Rename failed: ${result.error}`)
            } else if (result.mode === 'mixed') {
                addLog(st, `✅ Renamed ${result.renamed} files — 🎬 ${result.videos} videos (odd) + 🖼️ ${result.images} images (even)`)
            } else {
                addLog(st, `✅ Renamed ${result.renamed} files → 001, 002...`)
            }
        } catch (err: any) {
            addLog(st, `❌ Rename error: ${err.message || err}`)
        }
    }

    return {
        activeTab, sk1, sk3, sk3m, scriptContent, dropHover, autoRename,
        pickAudio, pickScript, pickVideoDir, pickImageDir, pickMediaDir, pickOutputDir,
        startTask, stopTask, openOutputFolder, handleDrop, clearFields, fileName, folderName,
        batchRenameFolder,
    }
}
