/**
 * useMerge — Composable for SK2 merge state & IPC calls.
 */

import { ref, onUnmounted } from 'vue'
import type { MergeConfig } from '../constants/merge-constants'

export function useMerge() {
    const isRunning = ref(false)
    const logs = ref<string[]>([])
    const finalVideoPath = ref('')
    const scanResult = ref<{ videos: string[]; audios: string[]; hasVideosDir: boolean; autoAudio?: string } | null>(null)

    let cleanupLog: (() => void) | null = null

    // Start listening for merge log events
    function setupLogListener() {
        cleanupLog = window.electronAPI.onMergeLog((msg: string) => {
            logs.value.push(msg)
        })
    }

    async function scanFolder(folderPath: string) {
        try {
            scanResult.value = await window.electronAPI.mergeScan(folderPath)
        } catch (e: any) {
            logs.value.push(`❌ Scan error: ${e.message}`)
        }
    }

    async function startMerge(config: MergeConfig) {
        logs.value = []
        finalVideoPath.value = ''
        isRunning.value = true
        setupLogListener()

        try {
            const result = await window.electronAPI.mergeRun(config)
            if (result.success && result.finalPath) {
                finalVideoPath.value = result.finalPath
            } else if (!result.success) {
                logs.value.push('❌ Merge failed')
            }
        } catch (e: any) {
            logs.value.push(`❌ Error: ${e.message}`)
        } finally {
            isRunning.value = false
            if (cleanupLog) { cleanupLog(); cleanupLog = null }
        }
    }

    async function stopMerge() {
        try {
            await window.electronAPI.mergeStop()
            logs.value.push('⏹ Stopping...')
        } catch (e: any) {
            logs.value.push(`❌ Stop error: ${e.message}`)
        }
    }

    onUnmounted(() => {
        if (cleanupLog) { cleanupLog(); cleanupLog = null }
    })

    return {
        isRunning,
        logs,
        finalVideoPath,
        scanResult,
        scanFolder,
        startMerge,
        stopMerge,
    }
}
