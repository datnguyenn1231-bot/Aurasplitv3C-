<script setup lang="ts">
/**
 * MergePanel — SK2 video merge settings.
 * Rendered inside EditorView's right settings panel.
 * Music is now a shared EditorView feature — received via prop.
 */
import { ref, computed, watch, nextTick } from 'vue'
import {
  FolderOpen, Play, Square, Trash2
} from 'lucide-vue-next'
import { useMerge } from '../../composables/useMerge'
import {
  TRANSITIONS_IN, TRANSITIONS_OUT, RANDOM_GROUPS,
  FINAL_OUTPUT_OPTIONS, type MergeConfig
} from '../../constants/merge-constants'

const props = defineProps<{ musicPath: string; applyHDR: boolean }>()
const emit = defineEmits<{ mergeComplete: [path: string] }>()

const { isRunning, logs, finalVideoPath, scanResult, scanFolder, startMerge, stopMerge } = useMerge()

// Auto-emit when merge completes with final video
watch(finalVideoPath, (path) => {
  if (path) emit('mergeComplete', path)
})

// ── Panel state ─────────────────────────────
const outputFolder = ref('')

const transitionIn = ref('None')
const transitionOut = ref('None')
const randomGroup = ref('')
const finalOutput = ref(FINAL_OUTPUT_OPTIONS[0].label)
const transitionDuration = ref(1.0)
const deleteOriginals = ref(false)
const logRef = ref<HTMLDivElement | null>(null)

// When Random group selected → override transitionIn
watch(randomGroup, (val) => {
  if (val) transitionIn.value = val
})
// When transitionIn manually changed to non-Random → clear Random
watch(transitionIn, (val) => {
  if (!val.startsWith('Random')) randomGroup.value = ''
})

// ── Computed ────────────────────────────────
const videoCount = computed(() => scanResult.value?.videos?.length ?? 0)
const canRun = computed(() => videoCount.value >= 1 && !isRunning.value)

// Auto-scroll log
watch(logs, async () => {
  await nextTick()
  if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
}, { deep: true })

// ── Actions ─────────────────────────────────
async function pickFolder() {
  const folder = await window.electronAPI.selectFolder()
  if (!folder) return
  outputFolder.value = folder
  await scanFolder(folder)
}

function run() {
  if (!outputFolder.value) return
  const config: MergeConfig = {
    outputFolder: outputFolder.value,
    transitionIn: transitionIn.value,
    transitionOut: transitionOut.value,
    transitionDuration: transitionDuration.value,
    finalOutput: finalOutput.value,
    musicPath: props.musicPath,
    deleteOriginals: deleteOriginals.value,
    applyHDR: props.applyHDR,
  }
  startMerge(config)
}

function openOutput() {
  if (outputFolder.value) window.electronAPI.openFolder(outputFolder.value)
}
</script>

<template>
  <div class="mp-body">
    <!-- Folder Picker -->
    <div class="mp-row">
      <button class="mp-pick" @click="pickFolder">
        <FolderOpen :size="14" />
        {{ outputFolder ? outputFolder.split('\\').pop() || outputFolder.split('/').pop() : 'Chọn thư mục' }}
      </button>
      <span v-if="videoCount > 0" class="mp-badge">{{ videoCount }} video</span>
    </div>

    <!-- 🎲 Random Dropdown (separate) -->
    <label class="mp-label">
      🎲 Ngẫu Nhiên
      <select v-model="randomGroup" class="mp-select mp-select-random">
        <option value="">— Chọn nhóm —</option>
        <option v-for="(val, label) in RANDOM_GROUPS" :key="val" :value="val">
          {{ label }}
        </option>
      </select>
    </label>

    <!-- Transition IN / OUT Row -->
    <div class="mp-trans-row">
      <label class="mp-label">
        Hiệu ứng VÀO
        <select v-model="transitionIn" class="mp-select">
          <template v-for="(items, group) in TRANSITIONS_IN" :key="group">
            <optgroup :label="String(group)">
              <option v-for="t in items" :key="t" :value="t">{{ t }}</option>
            </optgroup>
          </template>
        </select>
      </label>

      <label class="mp-label">
        Hiệu ứng RA
        <select v-model="transitionOut" class="mp-select">
          <template v-for="(items, group) in TRANSITIONS_OUT" :key="group">
            <optgroup :label="String(group)">
              <option v-for="t in items" :key="t" :value="t">{{ t }}</option>
            </optgroup>
          </template>
        </select>
      </label>
    </div>

    <!-- Output + Speed Row -->
    <div class="mp-grid">
      <label class="mp-label">
        Đầu ra
        <select v-model="finalOutput" class="mp-select">
          <option v-for="o in FINAL_OUTPUT_OPTIONS" :key="o.label" :value="o.label">{{ o.label }}</option>
        </select>
      </label>

      <label class="mp-label">
        Tốc độ: {{ transitionDuration.toFixed(1) }}s
        <input type="range" v-model.number="transitionDuration" min="0.5" max="3" step="0.1" class="mp-slider" />
      </label>
    </div>

    <!-- Delete originals -->
    <label class="mp-check">
      <input type="checkbox" v-model="deleteOriginals" />
      <Trash2 :size="12" />
      Xóa file gốc sau khi ghép
    </label>

    <!-- Action Buttons -->
    <div class="mp-actions">
      <button class="mp-btn run" @click="run" :disabled="!canRun">
        <Play :size="14" fill="currentColor" /> CHẠY
      </button>
      <button v-if="isRunning" class="mp-btn stop" @click="stopMerge">
        <Square :size="14" fill="currentColor" /> DỮNG
      </button>
      <button v-if="outputFolder" class="mp-btn open" @click="openOutput">📂 Mở</button>
    </div>

    <!-- Log -->
    <div v-if="logs.length > 0" ref="logRef" class="mp-log">
      <div v-for="(line, i) in logs" :key="i" class="mp-log-line">{{ line }}</div>
    </div>
  </div>
</template>

<style scoped>
.mp-body { padding: 10px 14px; }

.mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mp-pick {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.mp-pick:hover { border-color: var(--accent); color: var(--text); }

.mp-badge {
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.mp-clear {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
}
.mp-clear:hover { color: var(--red); }

.mp-trans-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.mp-trans-row .mp-label {
  flex: 1;
  min-width: 0;
}

.mp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.mp-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.mp-select {
  padding: 5px 6px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  font-size: 11px;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-select:focus { border-color: var(--accent); outline: none; }
.mp-select option { font-size: 12px; }
.mp-select optgroup { font-size: 11px; }
.mp-select-random {
  border-color: rgba(34, 211, 238, 0.25);
  margin-bottom: 4px;
}
.mp-select-random:not([value=""]) {
  border-color: var(--accent);
}

.mp-slider {
  width: 100%;
  accent-color: var(--accent);
}

.mp-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  margin-bottom: 10px;
}
.mp-check input { accent-color: var(--accent); }

.mp-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.mp-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.mp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mp-btn.run {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
  flex: 1;
}
.mp-btn.run:hover:not(:disabled) { filter: brightness(1.1); }
.mp-btn.stop { background: #ef4444; color: #fff; }
.mp-btn.stop:hover { filter: brightness(1.1); }
.mp-btn.open {
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.mp-btn.open:hover { border-color: var(--accent); color: var(--text); }

.mp-log {
  max-height: 200px;
  overflow-y: auto;
  background: #0a0a0a;
  border-radius: 6px;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
  font-size: 11px;
  line-height: 1.5;
}

.mp-log-line {
  color: #a0a0a0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
