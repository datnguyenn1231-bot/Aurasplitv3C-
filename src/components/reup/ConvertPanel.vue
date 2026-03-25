<script setup lang="ts">
/**
 * ConvertPanel — Horizontal → Vertical (TikTok 1080×1920) converter.
 */
import { ref, computed } from 'vue'
import { FolderOpen, Play, Square, MonitorSmartphone } from 'lucide-vue-next'
import { useReup } from '../../composables/useReup'

const { isRunning, logs, scanFolder, stopReup } = useReup()
const folderPath = ref('')
const videoCount = ref(0)

type OutputFormat = 'tiktok' | 'youtube' | 'square'
const outputFormat = ref<OutputFormat>('tiktok')
const formats: { value: OutputFormat; label: string; size: string }[] = [
  { value: 'tiktok', label: '📱 TikTok / Reels', size: '1080×1920' },
  { value: 'youtube', label: '🖥️ YouTube', size: '1920×1080' },
  { value: 'square', label: '⬛ Square', size: '1080×1080' },
]

const canRun = computed(() => !!folderPath.value && videoCount.value > 0 && !isRunning.value)

async function pickFolder() {
  const result = await window.electronAPI.selectFolder()
  if (result) {
    folderPath.value = result
    const scan = await scanFolder(result)
    videoCount.value = scan?.videos?.length || 0
  }
}

async function run() {
  if (!folderPath.value) return
  const config = {
    inputFolder: folderPath.value,
    outputFormat: outputFormat.value,
  }
  await window.electronAPI.reupRun({ config: { ...config, mode: 'convert' } as any })
}
</script>

<template>
  <div class="rp-panel">
    <div class="rp-section">
      <button class="rp-folder-btn" @click="pickFolder">
        <FolderOpen :size="14" />
        {{ folderPath ? folderPath.split('\\').pop() : 'Chọn thư mục' }}
      </button>
      <div v-if="videoCount > 0" class="rp-found">📂 Tìm thấy <strong>{{ videoCount }}</strong> video</div>
    </div>

    <div class="rp-section">
      <div class="rp-section-title"><MonitorSmartphone :size="12" /> Output Format</div>
      <div class="rp-radio-group">
        <label v-for="f in formats" :key="f.value" class="rp-radio-item" :class="{ active: outputFormat === f.value }">
          <input type="radio" :value="f.value" v-model="outputFormat" />
          <span class="rp-radio-label">{{ f.label }}</span>
          <span class="rp-radio-size">{{ f.size }}</span>
        </label>
      </div>
    </div>

    <div class="rp-actions">
      <button class="rp-btn run" @click="run" :disabled="!canRun"><Play :size="14" /> CONVERT</button>
      <button class="rp-btn stop" @click="stopReup" :disabled="!isRunning"><Square :size="14" /> STOP</button>
    </div>

    <div v-if="logs.length > 0" class="rp-log">
      <div v-for="(line, i) in logs" :key="i" class="rp-log-line">{{ line }}</div>
    </div>
  </div>
</template>

<style scoped>
.rp-panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.rp-section { display: flex; flex-direction: column; gap: 6px; }
.rp-section-title { font-size: 11px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.rp-folder-btn { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1px dashed var(--border-default); border-radius: 6px; background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer; font-size: 12px; transition: all 0.15s; }
.rp-folder-btn:hover { border-color: #f97316; background: rgba(249,115,22,0.06); color: #f97316; }
.rp-found { font-size: 11px; color: var(--text-muted); padding: 4px 8px; background: rgba(255,255,255,0.03); border-radius: 4px; }
.rp-radio-group { display: flex; flex-direction: column; gap: 4px; }
.rp-radio-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--text-secondary); transition: all 0.15s; }
.rp-radio-item:hover { background: rgba(255,255,255,0.04); }
.rp-radio-item.active { background: hsla(25, 80%, 50%, 0.1); color: #f97316; }
.rp-radio-item input { accent-color: #f97316; }
.rp-radio-label { flex: 1; }
.rp-radio-size { font-size: 10px; color: var(--text-muted); }
.rp-actions { display: flex; gap: 6px; }
.rp-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s; letter-spacing: 0.5px; }
.rp-btn.run { background: linear-gradient(135deg, #f97316, #ea580c); color: white; }
.rp-btn.run:hover:not(:disabled) { filter: brightness(1.1); }
.rp-btn.run:disabled { opacity: 0.4; cursor: not-allowed; }
.rp-btn.stop { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); }
.rp-btn.stop:hover:not(:disabled) { background: rgba(239,68,68,0.25); }
.rp-btn.stop:disabled { opacity: 0.3; cursor: not-allowed; }
.rp-log { max-height: 200px; overflow-y: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.5; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 6px; border: 1px solid var(--border-default); }
.rp-log-line { color: var(--text-muted); white-space: pre-wrap; word-break: break-all; }
</style>
