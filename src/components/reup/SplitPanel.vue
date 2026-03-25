<script setup lang="ts">
/**
 * SplitPanel — Video splitting: by duration or auto scene detection (like CapCut).
 */
import { ref, computed } from 'vue'
import { FolderOpen, Play, Square, Scissors, Film } from 'lucide-vue-next'
import { useReup } from '../../composables/useReup'

const { isRunning, logs, scanFolder, startReup, stopReup } = useReup()
const folderPath = ref('')
const videoCount = ref(0)

type SplitMode = 'segments' | 'scenes'
const splitMode = ref<SplitMode>('segments')
const segmentLength = ref(15) // seconds

// Scene detect: simple preset instead of raw numbers
type ScenePreset = 'fine' | 'normal' | 'rough'
const scenePreset = ref<ScenePreset>('normal')

const presets: { value: ScenePreset; label: string; desc: string; threshold: number; minSec: number }[] = [
  { value: 'fine',   label: 'Chi tiết',    desc: 'Cắt mọi chuyển cảnh nhỏ',     threshold: 0.15, minSec: 0.3 },
  { value: 'normal', label: 'Bình thường', desc: 'Phù hợp hầu hết video',       threshold: 0.3,  minSec: 0.5 },
  { value: 'rough',  label: 'Thô',         desc: 'Chỉ cắt khi đổi cảnh rõ ràng', threshold: 0.5,  minSec: 1.0 },
]

const modes: { value: SplitMode; icon: string; label: string }[] = [
  { value: 'segments', icon: '✂️', label: 'Chia theo giây' },
  { value: 'scenes',   icon: '🎬', label: 'Tách cảnh tự động' },
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
  const preset = presets.find(p => p.value === scenePreset.value) || presets[1]
  await startReup({
    inputFolder: folderPath.value,
    splitMode: splitMode.value,
    segmentLength: segmentLength.value,
    sceneThreshold: preset.threshold,
    minSceneSec: preset.minSec,
    mode: 'split',
  } as any)
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

    <!-- Mode Toggle -->
    <div class="rp-section">
      <div class="rp-mode-toggle">
        <button
          v-for="m in modes" :key="m.value"
          class="rp-mode-btn"
          :class="{ active: splitMode === m.value }"
          @click="splitMode = m.value"
        >
          <span class="rp-mode-icon">{{ m.icon }}</span>
          <span class="rp-mode-label">{{ m.label }}</span>
        </button>
      </div>
    </div>

    <!-- Duration Settings -->
    <div v-if="splitMode === 'segments'" class="rp-section">
      <div class="rp-section-title"><Scissors :size="12" /> Mỗi đoạn bao nhiêu giây</div>
      <div class="rp-slider-row">
        <input type="range" v-model.number="segmentLength" min="1" max="600" step="1" class="rp-slider" />
        <span class="rp-slider-val">{{ segmentLength }}s</span>
      </div>
    </div>

    <!-- Scene Detect Settings — Simple Presets -->
    <div v-if="splitMode === 'scenes'" class="rp-section">
      <div class="rp-section-title"><Film :size="12" /> Mức độ tách cảnh</div>
      <div class="rp-preset-group">
        <button
          v-for="p in presets" :key="p.value"
          class="rp-preset-btn"
          :class="{ active: scenePreset === p.value }"
          @click="scenePreset = p.value"
        >
          <span class="rp-preset-label">{{ p.label }}</span>
          <span class="rp-preset-desc">{{ p.desc }}</span>
        </button>
      </div>
    </div>

    <div class="rp-actions">
      <button class="rp-btn run" @click="run" :disabled="!canRun"><Play :size="14" /> PLAY</button>
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

/* Mode Toggle */
.rp-mode-toggle { display: flex; gap: 4px; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 3px; }
.rp-mode-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 8px; border: none; border-radius: 6px; background: transparent; color: var(--text-muted); font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.rp-mode-btn:hover { color: var(--text-secondary); background: rgba(255,255,255,0.04); }
.rp-mode-btn.active { background: hsla(25, 80%, 50%, 0.15); color: #f97316; font-weight: 600; }
.rp-mode-icon { font-size: 13px; }
.rp-mode-label { white-space: nowrap; }

/* Presets */
.rp-preset-group { display: flex; flex-direction: column; gap: 4px; }
.rp-preset-btn { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; background: rgba(255,255,255,0.02); color: var(--text-secondary); cursor: pointer; text-align: left; transition: all 0.15s; }
.rp-preset-btn:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
.rp-preset-btn.active { background: hsla(25, 80%, 50%, 0.1); border-color: hsla(25, 80%, 50%, 0.3); color: #f97316; }
.rp-preset-label { font-size: 12px; font-weight: 600; }
.rp-preset-desc { font-size: 10px; color: var(--text-muted); }
.rp-preset-btn.active .rp-preset-desc { color: hsla(25, 80%, 50%, 0.7); }

/* Sliders */
.rp-slider-row { display: flex; align-items: center; gap: 8px; }
.rp-slider { flex: 1; accent-color: #f97316; height: 4px; }
.rp-slider-val { font-size: 12px; font-weight: 600; color: #f97316; min-width: 35px; text-align: right; }

/* Actions */
.rp-actions { display: flex; gap: 6px; }
.rp-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s; letter-spacing: 0.5px; }
.rp-btn.run { background: linear-gradient(135deg, #f97316, #ea580c); color: white; }
.rp-btn.run:hover:not(:disabled) { filter: brightness(1.1); }
.rp-btn.run:disabled { opacity: 0.4; cursor: not-allowed; }
.rp-btn.stop { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); }
.rp-btn.stop:hover:not(:disabled) { background: rgba(239,68,68,0.25); }
.rp-btn.stop:disabled { opacity: 0.3; cursor: not-allowed; }

/* Log */
.rp-log { max-height: 200px; overflow-y: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.5; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 6px; border: 1px solid var(--border-default); }
.rp-log-line { color: var(--text-muted); white-space: pre-wrap; word-break: break-all; }
</style>
