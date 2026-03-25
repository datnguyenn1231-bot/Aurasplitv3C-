/**
 * useReupSubtitle — Composable for subtitle transcription state & IPC.
 * Extracted from ReupView.vue to enforce ≤300 lines/file.
 */

import { ref } from 'vue'
import type { TitleTemplate, SubAnimation, SubPosition } from '../constants/reup-constants'

interface SubSegment {
    start: number
    end: number
    text: string
}

/** Parse SRT file content into segments */
function parseSrtContent(srt: string): SubSegment[] {
    const segments: SubSegment[] = []
    // Normalize Windows \r\n to \n before parsing
    const normalized = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const blocks = normalized.trim().split(/\n\n+/)
    for (const block of blocks) {
        const lines = block.trim().split('\n')
        if (lines.length < 2) continue
        // Find the timestamp line (might be line 0, 1, or 2)
        let timeLine = -1
        for (let i = 0; i < Math.min(lines.length, 3); i++) {
            if (lines[i].includes('-->')) { timeLine = i; break }
        }
        if (timeLine < 0) continue
        const timeMatch = lines[timeLine].match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/)
        if (!timeMatch) continue
        const parseTs = (ts: string) => {
            const [h, m, rest] = ts.split(':')
            const [s, ms] = rest.split(/[,.]/)
            return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000
        }
        const text = lines.slice(timeLine + 1).join('\n').trim()
        if (!text) continue
        segments.push({
            start: parseTs(timeMatch[1]),
            end: parseTs(timeMatch[2]),
            text,
        })
    }
    return segments
}

export function useReupSubtitle() {
    // ── Language options ──
    const SUB_LANGUAGES = [
        { value: 'en', label: '🇺🇸 English' },
        { value: 'es', label: '🇪🇸 Spanish' },
        { value: 'fr', label: '🇫🇷 French' },
        { value: 'de', label: '🇩🇪 German' },
        { value: 'vi', label: '🇻🇳 Vietnamese' },
        { value: 'ko', label: '🇰🇷 Korean' },
        { value: 'ja', label: '🇯🇵 Japanese' },
        { value: 'zh', label: '🇨🇳 Chinese' },
    ]

    // ── State ──
    const showSub = ref(false)
    const subLang = ref('en')
    const subRunning = ref(false)
    const subProgress = ref(0)
    const subStatus = ref('')
    const subSegments = ref<SubSegment[]>([])
    const subSrtPath = ref('')
    const subDetectedLang = ref('')
    const subError = ref('')
    const subEngine = ref('')  // 'qwen' or 'whisper'
    const subLogs = ref<string[]>([])
    const showSubLog = ref(false)
    const subStyle = ref<TitleTemplate>('bold_center')
    const subFontSize = ref(22)
    const subAnimation = ref<SubAnimation>('fade')
    const subPosition = ref<SubPosition>('bottom')
    const subOffsetX = ref(0)
    const subOffsetY = ref(0)
    const subEditMode = ref(false)
    let subCleanup: (() => void) | null = null
    let resultFallbackTimer: ReturnType<typeof setTimeout> | null = null

    // ── Helpers ──
    function formatSubTime(seconds: number): string {
        const m = Math.floor(seconds / 60)
        const s = Math.floor(seconds % 60)
        return `${m}:${String(s).padStart(2, '0')}`
    }

    function segmentsToSrt(segments: SubSegment[]): string {
        return segments.map((seg, i) => {
            const fmt = (s: number) => {
                const h = Math.floor(s / 3600).toString().padStart(2, '0')
                const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
                const sec = Math.floor(s % 60).toString().padStart(2, '0')
                const ms = Math.floor((s % 1) * 1000).toString().padStart(3, '0')
                return `${h}:${m}:${sec},${ms}`
            }
            return `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text.trim()}\n`
        }).join('\n')
    }

    // ── Actions ──
    async function startSubTranscribe(videoPath: string) {
        if (!videoPath) return
        subRunning.value = true
        subProgress.value = 0
        subStatus.value = 'Starting...'
        subSegments.value = []
        subSrtPath.value = ''
        subDetectedLang.value = ''
        if (resultFallbackTimer) { clearTimeout(resultFallbackTimer); resultFallbackTimer = null }
        subError.value = ''
        subEngine.value = ''
        subLogs.value = []

        const taskId = `sub_${Date.now()}`
        const api = (window as any).electronAPI
        if (!api?.runPython) {
            subError.value = 'Electron API not available'
            subRunning.value = false
            return
        }

        // Listen for messages
        subCleanup = api.onPythonMessage(taskId, (msg: any) => {
            if (msg.type === 'progress') {
                subProgress.value = msg.percent || 0
                subStatus.value = msg.message || ''
                subLogs.value.push(`[${new Date().toLocaleTimeString()}] ${msg.message || ''}`)
                // Fallback: if progress=100 but no result yet, load SRT from disk
                if (msg.percent >= 100 && subSegments.value.length === 0) {
                    resultFallbackTimer = setTimeout(() => loadSegmentsFromSrt(), 1500)
                }
            } else if (msg.type === 'log') {
                subStatus.value = msg.message || ''
                subLogs.value.push(`[${new Date().toLocaleTimeString()}] ${msg.message || ''}`)
                // Capture SRT path from log message
                if (typeof msg.message === 'string' && msg.message.includes('SRT saved:')) {
                    const srtMatch = msg.message.match(/SRT saved:\s*(.+\.srt)/)
                    if (srtMatch) subSrtPath.value = srtMatch[1].trim()
                }
            } else if (msg.type === 'result' && msg.data) {
                if (resultFallbackTimer) { clearTimeout(resultFallbackTimer); resultFallbackTimer = null }
                subSrtPath.value = msg.data.srt_path || subSrtPath.value
                subDetectedLang.value = msg.data.language || ''
                subEngine.value = msg.data.engine || ''
                // If segments came through IPC, use them; otherwise fallback to SRT file
                if (msg.data.segments && msg.data.segments.length > 0) {
                    subSegments.value = msg.data.segments
                } else {
                    loadSegmentsFromSrt()
                }
                subProgress.value = 100
                subStatus.value = `✅ Done! ${msg.data.segments_count || 0} segments`
                subLogs.value.push(`[${new Date().toLocaleTimeString()}] ✅ Complete: ${msg.data.segments_count} segments (${msg.data.engine})`)
                subRunning.value = false
            } else if (msg.type === 'error') {
                subError.value = msg.message || 'Unknown error'
                subRunning.value = false
            } else if (msg.type === 'exit') {
                if (msg.code !== 0 && subRunning.value) {
                    subError.value = `Process exited with code ${msg.code}`
                }
                subRunning.value = false
            }
        })

        /** Fallback: load segments from saved SRT file on disk */
        async function loadSegmentsFromSrt() {
            if (subSegments.value.length > 0) return // already have segments
            const srtFile = subSrtPath.value
            if (!srtFile) {
                return
            }
            try {
                const api = (window as any).electronAPI
                if (api?.readFile) {
                    const content = await api.readFile(srtFile)
                    if (content) {
                        subSegments.value = parseSrtContent(content)
                        subStatus.value = `✅ Done! ${subSegments.value.length} segments`
                        subRunning.value = false
                    }
                }
            } catch (e) {
            }
        }

        // Run Python task
        await api.runPython(taskId, 'sub', {
            video_path: videoPath,
            lang_code: subLang.value,
            use_aligner: true,
        })
    }

    function stopSubTranscribe() {
        subRunning.value = false
        subStatus.value = 'Stopped'
        if (subCleanup) {
            subCleanup()
            subCleanup = null
        }
    }

    async function exportSrt(currentVideoPath: string) {
        if (!subSegments.value.length) return
        const srtContent = segmentsToSrt(subSegments.value)
        const videoName = currentVideoPath?.split('\\').pop()?.replace(/\.[^.]+$/, '') || 'subtitle'
        const saved = await window.electronAPI.saveFile({
            title: 'Export SRT Subtitle',
            defaultPath: `${videoName}.srt`,
            filters: [{ name: 'SRT Subtitle', extensions: ['srt'] }],
            content: srtContent,
        })
        if (saved) {
            subSrtPath.value = saved
            subStatus.value = `✅ SRT saved: ${saved.split('\\').pop()}`
        }
    }

    return {
        // Constants
        SUB_LANGUAGES,
        // State
        showSub, subLang, subRunning, subProgress, subStatus,
        subSegments, subSrtPath, subDetectedLang, subError,
        subEngine, subLogs, showSubLog,
        subStyle, subFontSize, subAnimation, subPosition,
        subOffsetX, subOffsetY, subEditMode,
        // Functions
        formatSubTime, startSubTranscribe, stopSubTranscribe, exportSrt,
    }
}
