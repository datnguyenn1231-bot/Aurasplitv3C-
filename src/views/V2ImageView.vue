<script setup lang="ts">
import {
  Film, FolderOpen, Play, Loader2, Image, Trash2
} from 'lucide-vue-next'
import { ref, onUnmounted } from 'vue'

const api = (window as any).electronAPI

// ── State ──
const inputPath = ref('')
const outputDir = ref('')
const outputName = ref('')
const fps = ref(1)
const format = ref('jpg')
const quality = ref(90)
const running = ref(false)
const progress = ref(0)
const logs = ref<string[]>([])
const taskId = ref('')
let cleanup: (() => void) | null = null

const FPS_OPTIONS = [
  { value: 0.2, label: '🐢 0.2 fps (5s/ảnh)' },
  { value: 0.5, label: '🚶 0.5 fps (2s/ảnh)' },
  { value: 1, label: '⏱️ 1 fps (1s/ảnh)' },
  { value: 2, label: '⚡ 2 fps' },
  { value: 5, label: '🔥 5 fps' },
  { value: 10, label: '💥 10 fps' },
  { value: 30, label: '🎞️ 30 fps (all frames)' },
]

const FORMAT_OPTIONS = [
  { value: 'jpg', label: '📷 JPG (nhỏ gọn)' },
  { value: 'png', label: '🖼️ PNG (không mất nét)' },
  { value: 'webp', label: '🌐 WEBP (hiện đại)' },
]

// ── File Pickers ──
const pickInput = async () => {
  const result = await api?.selectFiles?.({
    title: 'Chọn video hoặc folder',
    properties: ['openFile', 'openDirectory'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv'] },
    ],
  })
  if (result && result.length > 0) inputPath.value = result[0]
}

const pickOutput = async () => {
  const result = await api?.selectFolder?.()
  if (result) outputDir.value = result
}

// ── Helpers ──
const fileName = (p: string) => p ? p.split(/[\\/]/).pop() || p : ''
const folderName = (p: string) => p ? p.split(/[\\/]/).pop() || p : ''

// ── Run ──
const run = async () => {
  if (!inputPath.value || !outputDir.value) return
  running.value = true
  progress.value = 0
  logs.value = []

  const id = `v2img_${Date.now()}`
  taskId.value = id

  // Listen for events via typed preload
  cleanup = api?.onV2ImageMessage?.(id, (msg: any) => {
    if (msg.type === 'log' && msg.message) {
      logs.value.push(msg.message)
    }
    if (msg.type === 'progress' && msg.percent !== undefined) {
      progress.value = msg.percent
    }
    if (msg.type === 'done') {
      running.value = false
      progress.value = 100
    }
  })

  try {
    await api?.runV2Image?.(id, {
      inputPath: inputPath.value,
      outputDir: outputDir.value,
      outputName: outputName.value,
      fps: fps.value,
      format: format.value,
      quality: quality.value,
    })
  } catch (err: any) {
    logs.value.push(`❌ Error: ${err.message}`)
    running.value = false
  }
}

const stop = async () => {
  if (taskId.value) {
    await api?.stopV2Image?.(taskId.value)
    running.value = false
    logs.value.push('🛑 Stopped')
  }
}

const openOutput = () => {
  if (outputDir.value) api?.openFolder?.(outputDir.value)
}

const clearAll = () => {
  inputPath.value = ''
  outputDir.value = ''
  outputName.value = ''
  logs.value = []
  progress.value = 0
}

onUnmounted(() => {
  if (running.value && taskId.value) stop()
  cleanup?.()
})
</script>

<template>
  <div class="view">
    <div class="view-grid">
      <!-- LEFT: Config -->
      <div class="config-col">
        <header class="view-head">
          <div class="head-top">
            <div class="head-icon"><Image :size="20" /></div>
            <h1 class="head-title">Cắt ảnh</h1>
          </div>
          <p class="head-sub">Cắt video sang ảnh — batch extract frames</p>
        </header>

        <div class="panel">
          <!-- Input -->
          <div class="field">
            <label class="lbl"><Film :size="13" /> Video / Thư mục</label>
            <div class="picker" @click="pickInput">
              <span class="pname">{{ inputPath ? fileName(inputPath) : 'Chọn video hoặc folder...' }}</span>
              <FolderOpen :size="14" />
            </div>
          </div>

          <!-- Output -->
          <div class="field">
            <label class="lbl"><FolderOpen :size="13" /> Thư mục xuất</label>
            <div class="picker" @click="pickOutput">
              <span class="pname">{{ outputDir ? folderName(outputDir) : 'Chọn nơi lưu ảnh...' }}</span>
              <FolderOpen :size="14" />
            </div>
          </div>

          <!-- Output Name -->
          <div class="field">
            <label class="lbl">📝 Tên Folder Output</label>
            <input v-model="outputName" type="text" class="txt-input" placeholder="VD: video_frames_01" />
          </div>

          <!-- FPS + Format -->
          <div class="field-row">
            <div class="field">
              <label class="lbl">🎯 Tốc độ khung hình</label>
              <select v-model.number="fps" class="sel">
                <option v-for="o in FPS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div class="field">
              <label class="lbl">🖼️ Định dạng</label>
              <select v-model="format" class="sel">
                <option v-for="o in FORMAT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>

          <!-- Quality -->
          <div class="field">
            <label class="lbl">⭐ Chất lượng: {{ quality }}%</label>
            <input type="range" v-model.number="quality" min="10" max="100" step="5" class="slider" />
          </div>

          <!-- Buttons -->
          <div class="btn-group">
            <button v-if="!running" class="btn-run" :disabled="!inputPath || !outputDir" @click="run">
              <Play :size="16" /> ▶ CHẠY
            </button>
            <button v-else class="btn-run running" @click="stop">
              <Loader2 :size="16" class="spin" /> ⏹ DỮNG
            </button>
            <button v-if="outputDir" class="btn-output" @click="openOutput">
              <FolderOpen :size="14" /> 📂 Output
            </button>
            <button class="btn-clear" @click="clearAll" title="Xóa">
              <Trash2 :size="14" />
            </button>
          </div>

          <!-- Progress -->
          <div v-if="progress > 0" class="prog">
            <div class="prog-bar"><div class="prog-fill" :style="{ width: progress + '%' }" /></div>
            <span class="prog-pct">{{ progress }}%</span>
          </div>
        </div>
      </div>

      <!-- RIGHT: Logs -->
      <div class="logs-col">
        <div class="log-panel">
          <div class="log-header green">■ NHẬT KÝ CẮT ẢNH</div>
          <div class="log-body" id="v2imgLog">
            <div class="log-line" v-for="(log, i) in logs.slice(-100)" :key="i">{{ log }}</div>
            <div v-if="!logs.length" class="log-empty">Chọn video → RUN để cắt frames</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══ Layout ═══ */
.view { width: 100%; }
.view-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
@media (min-width: 900px) {
  .view-grid { grid-template-columns: minmax(380px, 500px) 1fr; }
}
.config-col { min-width: 0; }
.logs-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

/* ═══ Header ═══ */
.view-head { margin-bottom: 20px; }
.head-top { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.head-icon { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #f97316, #ea580c); display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 2px 16px hsla(25,90%,50%,0.25); }
.head-title { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
.head-sub { color: var(--text-secondary); font-size: 13px; padding-left: 48px; }

/* ═══ Panel ═══ */
.panel { background: var(--bg-card); border: 1px solid var(--border-default); border-radius: 14px; padding: 20px; margin-bottom: 16px; }
.field { margin-bottom: 12px; }
.lbl { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.4px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* ═══ Picker ═══ */
.picker { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); cursor: pointer; transition: all 0.2s; color: var(--text-secondary); }
.picker:hover { border-color: var(--accent); background: rgba(255,255,255,0.08); }
.pname { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }

/* ═══ Select ═══ */
.sel { width: 100%; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: var(--text-primary); font-size: 13px; font-family: inherit; cursor: pointer; outline: none; appearance: none; transition: all 0.2s; }
.sel:hover { border-color: rgba(255,255,255,0.20); }
.sel:focus { border-color: var(--accent); box-shadow: 0 0 0 2px hsla(var(--accent-h),60%,50%,0.15); }
.sel option { background: #1a1a2e; color: #fff; }

/* ═══ Text Input ═══ */
.txt-input { width: 100%; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: var(--text-primary); font-size: 13px; font-family: inherit; outline: none; transition: all 0.2s; box-sizing: border-box; }
.txt-input:hover { border-color: rgba(255,255,255,0.20); }
.txt-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px hsla(var(--accent-h),60%,50%,0.15); }
.txt-input::placeholder { color: var(--text-muted); }

/* ═══ Slider ═══ */
.slider { width: 100%; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); outline: none; cursor: pointer; -webkit-appearance: none; appearance: none; }
.slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); cursor: pointer; box-shadow: 0 0 8px hsla(var(--accent-h),60%,50%,0.3); }

/* ═══ Buttons ═══ */
.btn-run { display: flex; align-items: center; justify-content: center; gap: 8px; flex: 1; padding: 12px; border-radius: 10px; border: none; background: linear-gradient(135deg, #f97316, #ea580c); color: white; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all 0.2s; }
.btn-run:hover:not(:disabled) { box-shadow: 0 4px 20px hsla(25,80%,50%,0.3); transform: translateY(-1px); }
.btn-run:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-run.running { background: linear-gradient(135deg, #ef4444, #dc2626); }
.btn-group { display: flex; gap: 8px; }
.btn-output { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 12px 18px; border-radius: 10px; border: none; background: linear-gradient(135deg, #00c853, #009624); color: white; font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.btn-output:hover { box-shadow: 0 4px 20px hsla(145,80%,40%,0.3); transform: translateY(-1px); }
.btn-clear { display: flex; align-items: center; justify-content: center; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,100,100,0.2); background: rgba(255,80,80,0.06); color: #ff6b6b; cursor: pointer; transition: all 0.2s; }
.btn-clear:hover { background: rgba(255,80,80,0.15); border-color: rgba(255,100,100,0.4); }

/* ═══ Progress ═══ */
.prog { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.prog-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
.prog-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #f97316, #fbbf24); transition: width 0.3s; }
.prog-pct { font-size: 12px; color: var(--text-secondary); font-weight: 600; min-width: 36px; }

/* ═══ Log Panel ═══ */
.log-panel { background: #0c0c12; border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; flex: 1; }
.log-header { padding: 6px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }
.log-header.green { color: #00e676; }
.log-body { flex: 1; min-height: 300px; max-height: 70vh; overflow-y: auto; padding: 6px 10px; font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace; }
.log-line { font-size: 11px; color: #00ff00; line-height: 1.5; word-wrap: break-word; white-space: pre-wrap; }
.log-empty { font-size: 11px; color: #666; font-style: italic; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
