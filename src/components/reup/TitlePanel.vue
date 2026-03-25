<script setup lang="ts">
/**
 * TitlePanel — Batch add Title + Description text overlay on videos.
 */
import { ref, computed } from 'vue'
import { FolderOpen, Play, Square, Type } from 'lucide-vue-next'
import { useReup } from '../../composables/useReup'

const { isRunning, logs, scanFolder, stopReup } = useReup()
const folderPath = ref('')
const videoCount = ref(0)

const titleText = ref('')
const descText = ref('')
const useFilename = ref(true) // use filename as title

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
    titleText: titleText.value,
    descText: descText.value,
    useFilename: useFilename.value,
  }
  await window.electronAPI.reupRun({ config: { ...config, mode: 'title' } as any })
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
      <div class="rp-section-title"><Type :size="12" /> Title Settings</div>

      <label class="rp-check-row">
        <input type="checkbox" v-model="useFilename" />
        <span>Use filename as title</span>
      </label>

      <input
        v-if="!useFilename"
        v-model="titleText"
        class="rp-input"
        placeholder="Enter title text..."
      />

      <input
        v-model="descText"
        class="rp-input"
        placeholder="Description (bottom text)..."
      />
    </div>

    <div class="rp-actions">
      <button class="rp-btn run" @click="run" :disabled="!canRun"><Play :size="14" /> ADD TITLE</button>
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
.rp-check-row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; padding: 4px 0; }
.rp-check-row input { accent-color: #f97316; }
.rp-input { padding: 6px 10px; border: 1px solid var(--border-default); border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--text-primary); font-size: 12px; outline: none; transition: border-color 0.15s; }
.rp-input:focus { border-color: #f97316; }
.rp-input::placeholder { color: var(--text-muted); }
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
