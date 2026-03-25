/**
 * useReup — Composable for Reup state & IPC calls.
 */

import { ref, onUnmounted } from 'vue'
import type { ReupConfig } from '../constants/reup-constants'

export function useReup() {
    const isRunning = ref(false)
    const logs = ref<string[]>([])
    const scanResult = ref<{ videos: string[] } | null>(null)
    const engineProgress = ref(0)   // 0-100
    const engineFps = ref(0)

    let cleanupLog: (() => void) | null = null
    let cleanupLogReplace: (() => void) | null = null

    function setupLogListener() {
        cleanupLog = window.electronAPI.onReupLog((msg: string) => {
            logs.value.push(msg)
            // Reset progress bar on new clip or done
            if (msg.includes('Engine done') || msg.includes('Engine failed')) {
                engineProgress.value = 0
                engineFps.value = 0
            }
        })
        cleanupLogReplace = window.electronAPI.onReupLogReplace((msg: string) => {
            // Parse progress: "⚡ Processing: 98% (206 fps)"
            const m = msg.match(/Processing:\s*(\d+)%\s*\((\d+)\s*fps\)/)
            if (m) {
                engineProgress.value = parseInt(m[1])
                engineFps.value = parseInt(m[2])
                return  // Don't add to log
            }
            if (logs.value.length > 0) {
                logs.value[logs.value.length - 1] = msg
            } else {
                logs.value.push(msg)
            }
        })
    }

    async function scanFolder(folderPath: string) {
        try {
            scanResult.value = await window.electronAPI.reupScan(folderPath)
            return scanResult.value
        } catch (e: any) {
            logs.value.push(`❌ Scan error: ${e.message}`)
            return null
        }
    }

    async function startReup(config: ReupConfig) {
        logs.value = []
        isRunning.value = true
        setupLogListener()

        try {
            const result = await window.electronAPI.reupRun(config)
            if (!result.success) {
                logs.value.push('❌ Reup failed')
            }
        } catch (e: any) {
            logs.value.push(`❌ Error: ${e.message}`)
        } finally {
            isRunning.value = false
            if (cleanupLog) { cleanupLog(); cleanupLog = null }
            if (cleanupLogReplace) { cleanupLogReplace(); cleanupLogReplace = null }
        }
    }

    async function stopReup() {
        try {
            await window.electronAPI.reupStop()
            logs.value.push('⏹ Stopping...')
        } catch (e: any) {
            logs.value.push(`❌ Stop error: ${e.message}`)
        }
    }

    async function startAutoPipeline(opts: {
        folderPath?: string; outputDir?: string; baseConfig: ReupConfig;
        inputPath?: string; splitDuration?: number
    }) {
        logs.value = []
        isRunning.value = true
        setupLogListener()

        try {
            const result = await window.electronAPI.reupAutoPipeline(opts)
            if (!result.success) {
                logs.value.push(`❌ Auto Pipeline failed: ${result.error || 'Unknown error'}`)
            }
        } catch (e: any) {
            logs.value.push(`❌ Error: ${e.message}`)
        } finally {
            isRunning.value = false
            if (cleanupLog) { cleanupLog(); cleanupLog = null }
            if (cleanupLogReplace) { cleanupLogReplace(); cleanupLogReplace = null }
        }
    }

    onUnmounted(() => {
        if (cleanupLog) { cleanupLog(); cleanupLog = null }
        if (cleanupLogReplace) { cleanupLogReplace(); cleanupLogReplace = null }
    })

    return {
        isRunning,
        logs,
        scanResult,
        engineProgress,
        engineFps,
        scanFolder,
        startReup,
        startAutoPipeline,
        stopReup,
    }
}
