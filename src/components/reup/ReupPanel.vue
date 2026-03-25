<script setup lang="ts">
/**
 * ReupPanel — Full AutoReup Pipeline.
 * ALL features in one panel, one START button.
 *
 * 4 sections:
 *   1. Visual Filters (Mirror, Crop, Noise, Rotate, Lens, Color, Glow)
 *   2. Frame & Effects (Zoom, Border)
 *   3. Title / Part (text overlay)
 *   4. Enhance (Logo, HDR, Speed, Pitch, Volume)
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { FolderOpen, Play, Square, Repeat, Zap, Save, Trash2, Volume2 } from 'lucide-vue-next'
import { useReup } from '../../composables/useReup'
import {
  COLOR_GRADING_OPTIONS,
  ANTI_DETECT_LAYERS,
  RESET_PRESET,
  type ReupConfig,
  type ColorGradingStyle,
  type FrameTemplate,
  type TitleTemplate,
  type LogoPosition,
  type ReupPresetValues,
} from '../../constants/reup-constants'

const props = defineProps<{
  musicPath: string
  applyHDR: boolean
  // Visual Filters
  mirror: boolean
  crop: number
  cropX: number
  cropY: number
  noise: number
  rotate: number
  lensDistortion: boolean
  speed: number
  audioEvade: boolean
  removeAudio: boolean
  colorGrading: ColorGradingStyle
  glow: boolean
  volumeBoost: number
  // Templates
  frameTemplate: FrameTemplate
  titleTemplate: TitleTemplate
  titleText: string
  descText: string
  // Frame & Effects
  borderWidth: number
  borderColor: string
  zoomEffect: boolean
  zoomIntensity: number
  // Logo
  logoPath: string
  logoPosition: LogoPosition
  logoSize: number
  // Pixel-level anti-detect
  pixelEnlarge: number
  chromaShuffle: number
  rgbDrift: boolean
  // Advanced anti-detect
  frameJitter: number
  gammaShift: number
  microColorCycle: number
  dctNoise: number
  // Split Part
  splitEnabled: boolean
  splitDuration: number
  splitInputPath: string
  splitShowTitle: boolean
  splitShowPart: boolean
  // Overlay + Background
  overlayPath: string
  overlayOpacity: number
  overlayFiles: string[]
  bgBlur: boolean
  bgBlurAmount: number
}>()

const emit = defineEmits<{
  'update:mirror': [v: boolean]
  'update:crop': [v: number]
  'update:cropX': [v: number]
  'update:cropY': [v: number]
  'update:noise': [v: number]
  'update:rotate': [v: number]
  'update:lensDistortion': [v: boolean]
  'update:speed': [v: number]
  'update:audioEvade': [v: boolean]
  'update:removeAudio': [v: boolean]
  'update:colorGrading': [v: ColorGradingStyle]
  'update:glow': [v: boolean]
  'update:volumeBoost': [v: number]
  'update:titleTemplate': [v: TitleTemplate]
  'update:titleText': [v: string]
  'update:descText': [v: string]
  'update:borderWidth': [v: number]
  'update:borderColor': [v: string]
  'update:zoomEffect': [v: boolean]
  'update:zoomIntensity': [v: number]
  'update:logoPath': [v: string]
  'update:logoPosition': [v: LogoPosition]
  'update:logoSize': [v: number]
  'applyPreset': [values: ReupPresetValues]
  'update:pixelEnlarge': [v: number]
  'update:chromaShuffle': [v: number]
  'update:rgbDrift': [v: boolean]
  'getCurrentValues': []
}>()

// Local state for Smart Crop toggle (decoupled from values so sliders stay visible at 0%)
const cropEnabled = ref(props.cropX > 0 || props.cropY > 0 || props.crop > 0)

// â??????â?????? Custom Presets (localStorage) â??????â??????
const STORAGE_KEY = 'aurasplit_custom_presets'

interface CustomPreset {
  id: string
  label: string
  values: ReupPresetValues
}

const customPresets = ref<CustomPreset[]>([])
const showSaveInput = ref(false)
const newPresetName = ref('')

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) customPresets.value = JSON.parse(raw)
  } catch { customPresets.value = [] }
}

function saveCustomPresets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets.value))
}

onMounted(() => loadCustomPresets())

function saveCurrentAsPreset() {
  const name = newPresetName.value.trim()
  if (!name) return
  const values: ReupPresetValues = {
    mirror: props.mirror, crop: props.crop, noise: props.noise,
    rotate: props.rotate, lensDistortion: props.lensDistortion,
    hdr: props.applyHDR, speed: props.speed, audioEvade: props.audioEvade,
    colorGrading: props.colorGrading, glow: props.glow, volumeBoost: props.volumeBoost,
    frameTemplate: props.frameTemplate,
    titleTemplate: props.titleTemplate, titleText: props.titleText, descText: props.descText,
    borderWidth: props.borderWidth, borderColor: props.borderColor,
    zoomEffect: props.zoomEffect, zoomIntensity: props.zoomIntensity,
    logoPath: props.logoPath, logoPosition: props.logoPosition, logoSize: props.logoSize,
    pixelEnlarge: props.pixelEnlarge, chromaShuffle: props.chromaShuffle, rgbDrift: props.rgbDrift,
  }
  customPresets.value.push({ id: `custom_${Date.now()}`, label: name, values })
  saveCustomPresets()
  newPresetName.value = ''
  showSaveInput.value = false
}

function deleteCustomPreset(id: string) {
  customPresets.value = customPresets.value.filter(p => p.id !== id)
  saveCustomPresets()
}

// â??????â?????? 4-Layer Anti-Detect Defense â??????â??????
const activeLayers = ref<Set<string>>(new Set())

function isLayerActive(layerId: string): boolean {
  return activeLayers.value.has(layerId)
}

function toggleLayer(layerId: string) {
  const layer = ANTI_DETECT_LAYERS.find(l => l.id === layerId)
  if (!layer) return
  const next = new Set(activeLayers.value)
  if (next.has(layerId)) {
    // Turn OFF â?????? reset only this layer's filters to defaults
    next.delete(layerId)
    const resetValues: ReupPresetValues = {}
    for (const key of Object.keys(layer.values) as (keyof ReupPresetValues)[]) {
      (resetValues as any)[key] = (RESET_PRESET as any)[key]
    }
    emit('applyPreset', resetValues)
  } else {
    // Turn ON â?????? apply this layer's values
    next.add(layerId)
    emit('applyPreset', layer.values)
  }
  activeLayers.value = next
}

function activateFullShield() {
  const allValues: ReupPresetValues = {}
  const next = new Set<string>()
  for (const layer of ANTI_DETECT_LAYERS) {
    next.add(layer.id)
    Object.assign(allValues, layer.values)
  }
  activeLayers.value = next
  emit('applyPreset', allValues)
}

function resetAllLayers() {
  activeLayers.value = new Set()
  emit('applyPreset', RESET_PRESET)
}

const activeLayerCount = computed(() => activeLayers.value.size)

// â??????â?????? useReup â??????â??????
const { isRunning, logs, scanResult, engineProgress, engineFps, scanFolder, startReup, startAutoPipeline, stopReup } = useReup()

// â??????â?????? Folder â??????â??????
const folderPath = ref('')
const videoCount = computed(() => scanResult.value?.videos?.length ?? 0)
const cleanMetadata = ref(true)

// â??????â?????? Auto Split (local state) â??????â??????
const autoSplitVideo = ref('')
const autoSplitDuration = ref(60)  // seconds per segment
const autoFrameTemplate = ref<FrameTemplate>('9:16')

async function pickAutoSplitVideo() {
  const files = await window.electronAPI.selectFiles({
    title: 'Chá»n video ?????á»?? cáº¯t + random + export',
    filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] }]
  })
  if (files && files.length > 0) {
    autoSplitVideo.value = files[0]
  }
}

async function pickFolder() {
  const result = await window.electronAPI.selectFolder()
  if (result) {
    folderPath.value = result
    await scanFolder(result)
  }
}

// â??????â?????? Shuffle Pipeline (local state) â??????â??????
const shuffleFolder = ref('')
const shuffleTargetDuration = ref(60)
const shuffleDeleteOriginals = ref(false)
const shuffleRunning = ref(false)

async function pickShuffleFolder() {
  const result = await window.electronAPI.selectFolder()
  if (result) {
    shuffleFolder.value = result
  }
}

async function startShufflePipeline() {
  if (!shuffleFolder.value || shuffleRunning.value) return
  shuffleRunning.value = true
  logs.value = [] // clear old logs
  logs.value.push('ðY?????? Shuffle Pipeline starting...')
  logs.value.push('ðY??? Folder: ' + shuffleFolder.value)
  logs.value.push('â± Target: ' + shuffleTargetDuration.value + 's per video')
  logs.value.push('')

  const config: any = {
    inputFolder: shuffleFolder.value,
    mirror: props.mirror, crop: props.crop, cropX: props.cropX, cropY: props.cropY,
    noise: props.noise, rotate: props.rotate, lensDistortion: props.lensDistortion,
    hdr: props.applyHDR, speed: props.speed, audioEvade: props.audioEvade,
    cleanMetadata: cleanMetadata.value,
    colorGrading: props.colorGrading, glow: props.glow, volumeBoost: props.volumeBoost,
    frameTemplate: props.frameTemplate,
    borderWidth: props.borderWidth, borderColor: props.borderColor,
    zoomEffect: props.zoomEffect, zoomIntensity: props.zoomIntensity,
    pixelEnlarge: props.pixelEnlarge, chromaShuffle: props.chromaShuffle, rgbDrift: props.rgbDrift,
    frameJitter: props.frameJitter, gammaShift: props.gammaShift,
    microColorCycle: props.microColorCycle, dctNoise: props.dctNoise,
    bgBlur: props.bgBlur, bgBlurAmount: props.bgBlurAmount,
  }
  try {
    const api = window.electronAPI as any
    const result = await api.reupShufflePipeline({
      parentFolder: shuffleFolder.value,
      targetDuration: shuffleTargetDuration.value,
      deleteOriginals: shuffleDeleteOriginals.value,
      baseConfig: config,
    })
    if (result?.success) {
      logs.value.push('â????? Shuffle complete: ' + (result.finals || 0) + ' finals exported')
    } else {
      logs.value.push('â?? Shuffle failed: ' + (result?.error || 'Unknown error'))
    }
  } catch (e: any) {
    logs.value.push('â?? Shuffle error: ' + (e?.message || String(e)))
  } finally {
    shuffleRunning.value = false
  }
}



// â??????â?????? Computed â??????â??????
const canRun = computed(() => {
  const hasFolder = folderPath.value && videoCount.value > 0
  const hasAutoSplit = !!autoSplitVideo.value && autoSplitDuration.value > 0
  const hasShuffle = !!shuffleFolder.value
  return (hasFolder || hasAutoSplit || hasShuffle) && !isRunning.value
})
const activeFilterCount = computed(() => {
  let c = 0
  if (props.mirror) c++
  if (props.crop > 0) c++
  if (props.noise > 0) c++
  if (props.rotate) c++
  if (props.lensDistortion) c++
  if (props.applyHDR) c++
  if (props.speed !== 1.0) c++
  if (props.audioEvade) c++
  if (cleanMetadata.value) c++
  if (props.colorGrading !== 'none') c++
  if (props.glow) c++
  if (props.volumeBoost !== 1.0) c++
  if (props.borderWidth > 0) c++
  if (props.zoomEffect) c++
  if (props.logoPath) c++
  return c
})

const showVisual = ref(true)
const showFullLog = ref(false)

// â??????â?????? Log scroll â??????â??????
const logRef = ref<HTMLDivElement | null>(null)
watch(logs, async () => {
  await nextTick()
  if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
}, { deep: true })

function run() {
  const config: ReupConfig = {
    inputFolder: folderPath.value || (props.splitInputPath ? props.splitInputPath.replace(/[\\/][^\\/]+$/, '') : ''),
    mirror: props.mirror,
    crop: props.crop,
    cropX: props.cropX,
    cropY: props.cropY,
    noise: props.noise,
    rotate: props.rotate,
    lensDistortion: props.lensDistortion,
    hdr: props.applyHDR,
    speed: props.speed,
    audioEvade: props.audioEvade,
    cleanMetadata: cleanMetadata.value,
    musicPath: props.musicPath,
    colorGrading: props.colorGrading,
    glow: props.glow,
    volumeBoost: props.volumeBoost,
    frameTemplate: props.frameTemplate,
    titleTemplate: props.titleTemplate,
    titleText: props.titleText,
    descText: props.descText,
    borderWidth: props.borderWidth,
    borderColor: props.borderColor,
    zoomEffect: props.zoomEffect,
    zoomIntensity: props.zoomIntensity,
    logoPath: props.logoPath,
    logoPosition: props.logoPosition,
    logoSize: props.logoSize,
    pixelEnlarge: props.pixelEnlarge,
    chromaShuffle: props.chromaShuffle,
    rgbDrift: props.rgbDrift,
    frameJitter: props.frameJitter,
    gammaShift: props.gammaShift,
    microColorCycle: props.microColorCycle,
    dctNoise: props.dctNoise,
    splitMode: 'none',
    segmentLength: 15,
    splitEnabled: props.splitEnabled,
    splitDuration: props.splitDuration,
    splitShowTitle: props.splitShowTitle,
    splitShowPart: props.splitShowPart,
    overlayPath: props.overlayPath || undefined,
    overlayOpacity: props.overlayOpacity,
    overlayRandom: true,
    bgBlur: props.bgBlur,
    bgBlurAmount: props.bgBlurAmount,
  }

  // Shuffle Pipeline: folder of subfolders with clips
  if (shuffleFolder.value) {

    startShufflePipeline()
    return
  }

  // Auto Pipeline: folder of cut clips OR single video + auto split
  if (folderPath.value && videoCount.value > 0) {
    // Mode 1: Folder of existing clips -> random -> export
    startAutoPipeline({
      folderPath: folderPath.value,
      outputDir: folderPath.value + '/exported',
      baseConfig: config,
    })
  } else if (autoSplitVideo.value && autoSplitDuration.value > 0) {
    // Mode 2: Single video -> auto split -> random -> export
    startAutoPipeline({
      inputPath: autoSplitVideo.value,
      splitDuration: autoSplitDuration.value,
      baseConfig: { ...config, frameTemplate: autoFrameTemplate.value },
    })
  } else {
    startReup(config)
  }
}
</script>


<template>
  <div class="rp-panel">
    <!-- Folder Picker -->
    <div class="rp-section">
      <div style="display:flex; align-items:center; gap:4px;">
        <button class="rp-folder-btn" style="flex:1;" @click="pickFolder">
          <FolderOpen :size="14" />
          {{ folderPath ? folderPath.split('\\').pop() : 'Chọn thư mục' }}
        </button>
        <button v-if="folderPath" class="rp-clear-btn" @click="folderPath = ''" title="Xóa folder">✕</button>
      </div>
      <div v-if="videoCount > 0" class="rp-found">
        📂 Tìm thấy <strong>{{ videoCount }}</strong> video
      </div>
    </div>

    <!-- Auto Split: Pick video + set duration -->
    <div class="rp-section">
      <div class="rp-section-header">
        <span>✂️ Tự động cắt + Xuất ngẫu nhiên</span>
      </div>
      <div class="rp-section-body">
        <div style="display:flex; align-items:center; gap:4px;">
          <button class="rp-folder-btn" style="flex:1;" @click="pickAutoSplitVideo">
            🎬 {{ autoSplitVideo ? autoSplitVideo.split('\\').pop() : 'Chọn video YouTube' }}
          </button>
          <button v-if="autoSplitVideo" class="rp-clear-btn" @click="autoSplitVideo = ''" title="Xóa video">✕</button>
        </div>
        <div v-if="autoSplitVideo" class="rp-slider-row" style="margin-top:6px;">
          <span style="font-size:10px; color: var(--text-muted);">Mỗi clip</span>
          <input type="range" min="15" max="300" step="5" v-model.number="autoSplitDuration" class="rp-slider" />
          <span class="rp-slider-val">{{ autoSplitDuration }}s</span>
        </div>
        <div v-if="autoSplitVideo" class="rp-select-row" style="margin-top:6px;">
          <span class="rp-select-label">📐 Khung hình</span>
          <select class="rp-select" v-model="autoFrameTemplate">
            <option value="9:16">9:16 (TikTok/Shorts)</option>
            <option value="16:9">16:9 (YouTube)</option>
            <option value="1:1">1:1 (Instagram)</option>
            <option value="4:3">4:3</option>
            <option value="none">Giữ nguyên</option>
          </select>
        </div>
        <p v-if="autoSplitVideo" style="font-size:9px; color:var(--text-muted); margin:4px 0 0; line-height:1.3;">
          Video sẽ tự cắt → random ALL thông số → export → clean metadata
        </p>
      </div>
    </div>


    <!-- SHUFFLE PIPELINE -->
    <div class="rp-section">
      <div class="rp-section-header">
        <span>🔀 Trộn xáo Pipeline</span>
      </div>
      <div class="rp-section-body">
        <div style="display:flex; align-items:center; gap:4px;">
          <button class="rp-folder-btn" style="flex:1;" @click="pickShuffleFolder">
            📁 {{ shuffleFolder ? shuffleFolder.split('\\').pop() : 'Chọn Folder chứa subfolders' }}
          </button>
          <button v-if="shuffleFolder" class="rp-clear-btn" @click="shuffleFolder = ''" title="Xóa folder">✕</button>
        </div>
        <div v-if="shuffleFolder" style="margin-top:6px;">
          <div class="rp-found">
            📂 Đã chọn folder
          </div>
          <div class="rp-slider-row" style="margin-top:6px;">
            <span style="font-size:10px; color: var(--text-muted);">⏱ Video</span>
            <input type="range" min="30" max="180" step="10" v-model.number="shuffleTargetDuration" class="rp-slider" />
            <span class="rp-slider-val">{{ shuffleTargetDuration }}s</span>
          </div>
          <label class="rp-check" style="margin-top:4px;">
            <input type="checkbox" v-model="shuffleDeleteOriginals" />
            🗑️ Xóa video gốc sau khi xong
          </label>
          <p style="font-size:9px; color:var(--text-muted); margin:4px 0 0; line-height:1.3;">
            Shuffle thứ tự cảnh → random mirror → ghép → random effects → export
          </p>
        </div>
      </div>
    </div>

    <div class="rp-divider" />

    <!-- ═══════ 4-LAYER ANTI-DETECT DEFENSE ═══════ -->
    <div class="rp-section">
      <div class="rp-section-header">
        <Zap :size="12" />
        <span>Chống phát hiện</span>
        <span v-if="activeLayerCount > 0" class="rp-layer-count">{{ activeLayerCount }}/4</span>
      </div>

      <!-- Master buttons -->
      <div class="rp-shield-row">
        <button class="rp-shield-btn" :class="{ active: activeLayerCount === 4 }" @click="activateFullShield" title="Bật tất cả 4 lớp phòng thủ">
          🛡️ BẬT HẾT
        </button>
        <button class="rp-reset-btn-master" @click="resetAllLayers" title="Tắt tất cả">
          🔄 Đặt lại
        </button>
      </div>

      <!-- Compact layer labels — glow when active -->
      <div v-if="activeLayerCount > 0" class="rp-layer-compact">
        <span
          v-for="layer in ANTI_DETECT_LAYERS" :key="layer.id"
          class="rp-layer-pill" :class="{ active: isLayerActive(layer.id) }"
          @click="toggleLayer(layer.id)"
          :title="layer.desc"
        >{{ layer.emoji }} {{ layer.label }}</span>
      </div>
    </div>

      <!-- Custom presets -->
      <div v-if="customPresets.length > 0" class="rp-custom-presets">
        <div
          v-for="cp in customPresets" :key="cp.id"
          class="rp-custom-card"
        >
          <button class="rp-custom-load" @click="emit('applyPreset', cp.values)" :title="cp.label">
            ⭐ {{ cp.label }}
          </button>
          <button class="rp-custom-delete" @click="deleteCustomPreset(cp.id)" title="Xóa">
            <Trash2 :size="10" />
          </button>
        </div>
      </div>

      <!-- Save current as preset -->
      <div class="rp-save-row">
        <button v-if="!showSaveInput" class="rp-save-btn" @click="showSaveInput = true">
          <Save :size="11" /> 💾 Lưu preset hiện tại
        </button>
        <div v-else class="rp-save-input-row">
          <input
            v-model="newPresetName"
            class="rp-save-input"
            placeholder="Đặt tên preset..."
            @keyup.enter="saveCurrentAsPreset"
            autofocus
          />
          <button class="rp-save-confirm" @click="saveCurrentAsPreset" :disabled="!newPresetName.trim()">✓</button>
          <button class="rp-save-cancel" @click="showSaveInput = false; newPresetName = ''">✕</button>
        </div>
      </div>

    <div class="rp-divider" />

    <!-- ═══════ SECTION 1: Visual Filters ═══════ -->
    <div class="rp-section">
      <div class="rp-section-header" @click="showVisual = !showVisual">
        <Repeat :size="12" />
        <span>Bộ lọc hình ảnh ({{ activeFilterCount }})</span>
        <span class="rp-chevron" :class="{ open: showVisual }">▾</span>
      </div>

      <div v-if="showVisual" class="rp-section-body">
        <!-- L1: Mirror -->
        <label class="rp-check">
          <input type="checkbox" :checked="mirror" @change="emit('update:mirror', ($event.target as HTMLInputElement).checked)" />
          🪞 Lật gương
        </label>

        <!-- L2: Smart Crop X/Y -->
        <label class="rp-check">
          <input type="checkbox" :checked="cropEnabled" @change="{ const on = ($event.target as HTMLInputElement).checked; cropEnabled = on; if (!on) { emit('update:cropX', 0); emit('update:cropY', 0); emit('update:crop', 0) } }" />
          🔍 Cắt thông minh
        </label>
        <div v-if="cropEnabled" class="rp-slider-row" style="flex-direction: column; gap: 4px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:10px; color: var(--text-muted); min-width:32px;">X</span>
            <input type="range" min="0" max="0.50" step="0.01" :value="cropX" @input="{ const v = parseFloat(($event.target as HTMLInputElement).value); emit('update:cropX', v); emit('update:crop', Math.max(v, cropY)) }" class="rp-slider" style="flex:1" />
            <span class="rp-slider-val">{{ Math.round(cropX * 100) }}%</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:10px; color: var(--text-muted); min-width:32px;">Y</span>
            <input type="range" min="0" max="0.50" step="0.01" :value="cropY" @input="{ const v = parseFloat(($event.target as HTMLInputElement).value); emit('update:cropY', v); emit('update:crop', Math.max(cropX, v)) }" class="rp-slider" style="flex:1" />
            <span class="rp-slider-val">{{ Math.round(cropY * 100) }}%</span>
          </div>
        </div>

        <!-- L3: Noise/Grain (intensity slider) -->
        <label class="rp-check">
          <input type="checkbox" :checked="noise > 0" @change="emit('update:noise', ($event.target as HTMLInputElement).checked ? 50 : 0)" />
          🌫️ Nhiễu hạt
        </label>
        <div v-if="noise > 0" class="rp-slider-row" style="padding-left: 22px;">
          <span style="font-size:10px; color: var(--text-muted);">Cường độ</span>
          <input type="range" min="1" max="100" step="1" :value="noise" @input="emit('update:noise', +($event.target as HTMLInputElement).value)" class="rp-slider" />
          <span class="rp-val">{{ noise }}%</span>
        </div>

        <!-- L4: Rotate -->
        <label class="rp-check">
          <input type="checkbox" :checked="rotate !== 0" @change="emit('update:rotate', ($event.target as HTMLInputElement).checked ? 2 : 0)" />
          🔄 Xoay nhẹ
        </label>
        <div v-if="rotate !== 0" class="rp-slider-row">
          <input type="range" min="-10" max="10" step="0.5" :value="rotate" @input="emit('update:rotate', parseFloat(($event.target as HTMLInputElement).value))" class="rp-slider" />
          <span class="rp-slider-val">{{ rotate }}°</span>
        </div>

        <!-- L5: Lens Distortion -->
        <label class="rp-check">
          <input type="checkbox" :checked="lensDistortion" @change="emit('update:lensDistortion', ($event.target as HTMLInputElement).checked)" />
          🔮 Méo ống kính
        </label>

        <!-- L6: Color Grading -->
        <div class="rp-select-row">
          <span class="rp-select-label">🎨 Màu sắc</span>
          <select class="rp-select" :value="colorGrading" @change="emit('update:colorGrading', ($event.target as HTMLSelectElement).value as ColorGradingStyle)">
            <option v-for="o in COLOR_GRADING_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <!-- L7: Glow/Bloom -->
        <label class="rp-check">
          <input type="checkbox" :checked="glow" @change="emit('update:glow', ($event.target as HTMLInputElement).checked)" />
          ✨ Phát sáng
        </label>

        <!-- L8: Zoom Effect -->
        <label class="rp-check">
          <input type="checkbox" :checked="zoomEffect" @change="emit('update:zoomEffect', ($event.target as HTMLInputElement).checked)" />
          🔎 Hiệu ứng zoom
        </label>
        <div v-if="zoomEffect" class="rp-slider-row">
          <input type="range" min="1.05" max="1.5" step="0.05" :value="zoomIntensity" @input="emit('update:zoomIntensity', parseFloat(($event.target as HTMLInputElement).value))" class="rp-slider" />
          <span class="rp-slider-val">{{ zoomIntensity.toFixed(2) }}x</span>
        </div>

        <!-- L9: Border -->
        <label class="rp-check">
          <input type="checkbox" :checked="borderWidth > 0" @change="emit('update:borderWidth', ($event.target as HTMLInputElement).checked ? 4 : 0)" />
          🔲 Border / Viền
        </label>
        <div v-if="borderWidth > 0" class="rp-slider-row">
          <input type="range" min="2" max="20" step="1" :value="borderWidth" @input="emit('update:borderWidth', parseFloat(($event.target as HTMLInputElement).value))" class="rp-slider" />
          <span class="rp-slider-val">{{ borderWidth }}px</span>
          <input type="color" :value="borderColor" @input="emit('update:borderColor', ($event.target as HTMLInputElement).value)" class="rp-color" />
        </div>

        <!-- L0: Clean Metadata -->
        <label class="rp-check rp-always">
          <input type="checkbox" v-model="cleanMetadata" disabled />
          🧹 Xóa Metadata
          <span class="rp-always-badge">Luôn bật</span>
        </label>
      </div>
    </div>

    <div class="rp-divider" />

    <!-- ═══════ SECTION 2: Audio Anti-Detect ═══════ -->
    <div class="rp-section">
      <div class="rp-section-header">
        <Volume2 :size="12" />
        <span>Chống phát hiện âm thanh</span>
      </div>
      <div class="rp-section-body">
        <!-- Speed -->
        <label class="rp-check">
          <input type="checkbox" :checked="speed !== 1.0" @change="emit('update:speed', ($event.target as HTMLInputElement).checked ? 1.5 : 1.0)" />
          ⏩ Tốc độ
        </label>
        <div v-if="speed !== 1.0" class="rp-slider-row">
          <input type="range" min="0.5" max="3.0" step="0.1" :value="speed" @input="emit('update:speed', parseFloat(($event.target as HTMLInputElement).value))" class="rp-slider" />
          <span class="rp-slider-val">{{ speed.toFixed(1) }}x</span>
        </div>

        <!-- Lách âm thanh -->
        <label class="rp-check">
          <input type="checkbox" :checked="audioEvade" @change="emit('update:audioEvade', ($event.target as HTMLInputElement).checked)" />
          🔊 Lách âm thanh
        </label>
        <p v-if="audioEvade" style="font-size:9px; color:var(--text-muted); margin:0; padding:0 4px 0 24px; line-height:1.3;">Pitch shift + Channel swap + EQ random + Micro-echo — phá audio fingerprint</p>

        <!-- Remove Audio -->
        <label class="rp-check">
          <input type="checkbox" :checked="removeAudio" @change="emit('update:removeAudio', ($event.target as HTMLInputElement).checked)" />
          🔇 Loại bỏ âm thanh gốc
        </label>
        <p v-if="removeAudio" style="font-size:9px; color:#ff6b6b; margin:0; padding:0 4px 0 24px; line-height:1.3;">⚠️ Video xuất ra sẽ không có âm thanh</p>
      </div>
    </div>

    <div class="rp-divider" />

    <!-- Actions (at top for quick access) -->
    <div class="rp-actions">
      <button class="rp-btn run" @click="run" :disabled="!canRun">
        <Play :size="14" />
        BẮT ĐẦU REUP
      </button>
      <button class="rp-btn stop" @click="stopReup" :disabled="!isRunning && !shuffleRunning">
        <Square :size="14" />
        DỪNG
      </button>
    </div>
  </div>

  <!-- Engine Progress Bar -->
  <div v-if="engineProgress > 0" style="margin:0 8px 4px; display:flex; align-items:center; gap:6px;">
    <div style="flex:1; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
      <div :style="{ width: engineProgress + '%', height: '100%', background: 'linear-gradient(90deg, #00d4ff, #7c3aed)', borderRadius: '3px', transition: 'width 0.3s ease' }" />
    </div>
    <span style="font-size:10px; color:var(--text-muted); min-width:70px; text-align:right;">{{ engineProgress }}% · {{ engineFps }} fps</span>
  </div>

  <!-- Logs (collapsible — compact by default) -->
  <div v-if="logs.length > 0" class="rp-log-wrap" style="margin:0 8px 8px;">
    <div class="rp-log-header" @click="showFullLog = !showFullLog" style="display:flex; align-items:center; justify-content:space-between; padding:4px 8px; cursor:pointer; font-size:10px; color:var(--text-muted); border-radius:6px 6px 0 0; background:rgba(0,0,0,0.15);">
      <span>📋 Log ({{ logs.length }})</span>
      <span>{{ showFullLog ? '▲ Thu gọn' : '▼ Xem thêm' }}</span>
    </div>
    <div ref="logRef" class="rp-log" :style="{ maxHeight: showFullLog ? '200px' : '48px' }" style="flex-shrink:0; border-radius:0 0 6px 6px; transition:max-height 0.2s ease;">
      <div v-for="(line, i) in logs" :key="i" class="rp-log-line">{{ line }}</div>
    </div>
  </div>
</template>

<style src="../../styles/reup-panel.css" scoped></style>
