/**
 * useEditor — Core composable for Video Editor.
 * Manages video import, metadata, and playback state.
 * ~120 lines — follows 300-line rule.
 */

import { ref, computed } from 'vue'

// ── Types ───────────────────────────────────
export interface VideoMetadata {
    width: number
    height: number
    duration: number
    codec: string
    fps: number
    bitrate: number
    fileSize: number
    audioCodec: string
    audioSampleRate: number
    fileName: string
}

// ── State (module-level singleton) ──────────
const videoPath = ref<string | null>(null)
const videoUrl = ref<string | null>(null)
const metadata = ref<VideoMetadata | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

// Playback state (synced from VideoPreview component)
const isPlaying = ref(false)
const currentTime = ref(0)
const totalDuration = ref(0)
const volume = ref(1)

// ── Computed ────────────────────────────────
const hasVideo = computed(() => !!videoPath.value)

const formattedDuration = computed(() => {
    const s = metadata.value?.duration ?? 0
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
})

const resolution = computed(() => {
    if (!metadata.value) return ''
    return `${metadata.value.width}×${metadata.value.height}`
})

// ── Parse ffprobe output ────────────────────
function parseProbeData(data: any, filePath: string): VideoMetadata {
    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video') ?? {}
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio') ?? {}
    const format = data.format ?? {}

    // Parse FPS from r_frame_rate (e.g., "30000/1001" or "30/1")
    let fps = 0
    if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/')
        fps = den ? Math.round((+num / +den) * 100) / 100 : +num
    }

    // Extract filename from path
    const fileName = filePath.split(/[\\/]/).pop() ?? ''

    return {
        width: videoStream.width ?? 0,
        height: videoStream.height ?? 0,
        duration: parseFloat(format.duration ?? '0'),
        codec: videoStream.codec_name ?? 'unknown',
        fps,
        bitrate: parseInt(format.bit_rate ?? '0', 10),
        fileSize: parseInt(format.size ?? '0', 10),
        audioCodec: audioStream.codec_name ?? 'none',
        audioSampleRate: parseInt(audioStream.sample_rate ?? '0', 10),
        fileName,
    }
}

// ── Import Video ────────────────────────────
async function importVideo() {
    try {
        const paths = await window.electronAPI.selectFiles({
            title: 'Import Video',
            filters: [
                { name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts'] },
            ],
        })
        if (!paths || paths.length === 0) return
        await loadVideo(paths[0])
    } catch (e: any) {
        error.value = e.message ?? 'Import failed'
    }
}


async function loadVideo(filePath: string) {
    isLoading.value = true
    error.value = null
    try {
        // Probe metadata via FFmpeg IPC
        const probeData = await window.electronAPI.probeFile(filePath)
        metadata.value = parseProbeData(probeData, filePath)
        videoPath.value = filePath

        // Show original video immediately via local-media:// protocol
        videoUrl.value = await window.electronAPI.getMediaUrl(filePath)

        totalDuration.value = metadata.value.duration
        currentTime.value = 0
        isPlaying.value = false

        // Background: remux with frequent keyframes for instant seeking
        window.electronAPI.remuxForSeeking(filePath).then(async (remuxedPath) => {
            // Only swap if still showing the same video
            if (videoPath.value !== filePath) return
            const remuxedUrl = await window.electronAPI.getMediaUrl(remuxedPath)
            videoUrl.value = remuxedUrl
        }).catch(() => {
            // Keep original — seeking will be slightly slower at beginning
        })
    } catch (e: any) {
        error.value = e.message ?? 'Failed to load video'
        videoPath.value = null
        videoUrl.value = null
        metadata.value = null
    } finally {
        isLoading.value = false
    }
}

function closeVideo() {
    videoPath.value = null
    videoUrl.value = null
    metadata.value = null
    isPlaying.value = false
    currentTime.value = 0
    totalDuration.value = 0
    error.value = null
}

// ── Export composable ───────────────────────
export function useEditor() {
    return {
        // State
        videoPath,
        videoUrl,
        metadata,
        isLoading,
        error,
        isPlaying,
        currentTime,
        totalDuration,
        volume,
        // Computed
        hasVideo,
        formattedDuration,
        resolution,
        // Actions
        importVideo,
        loadVideo,
        closeVideo,
    }
}
