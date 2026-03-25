<script setup lang="ts">
/**
 * ReupView — Video Reup main view.
 * 3-column: Left Toolbar | Center Preview (live CSS) | Right Settings
 *
 * Top bar: Ratio dropdown + Music picker + HDR toggle
 * Toolbar: AutoReup | Cut | Music
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  Repeat, Music, Sun, Settings2, Loader2, X, MonitorSmartphone, ChevronDown,
  Image, Download,
} from 'lucide-vue-next'
import { useEditor } from '../composables/useEditor'
import { useReupPreview } from '../composables/useReupPreview'
import {
  REUP_DEFAULTS, FRAME_TEMPLATE_OPTIONS, TITLE_TEMPLATE_OPTIONS, SUB_ANIMATION_OPTIONS, SUB_POSITION_OPTIONS,
  type ColorGradingStyle, type FrameTemplate, type TitleTemplate,
  type SplitMode, type LogoPosition, type ReupPresetValues,
} from '../constants/reup-constants'

const LOGO_POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: 'top-left', label: '↖ Trên trái' },
  { value: 'top-right', label: '↗ Trên phải' },
  { value: 'bottom-left', label: '↙ Dưới trái' },
  { value: 'bottom-right', label: '↘ Dưới phải' },
]

const TEXT_FONTS = [
  'Dancing Script', 'Pacifico', 'Lobster', 'Sigmar One', 'Bungee Shade',
  'Patrick Hand', 'Dela Gothic One', 'Fugaz One', 'Luckiest Guy', 'Bangers',
]
import VideoPreview from '../components/editor/VideoPreview.vue'
import ReupToolbar from '../components/reup/ReupToolbar.vue'
import ReupDropzone from '../components/reup/ReupDropzone.vue'
import ReupPanel from '../components/reup/ReupPanel.vue'
import SplitPanel from '../components/reup/SplitPanel.vue'
import { useReupSubtitle } from '../composables/useReupSubtitle'

// ── Editor (video preview) ──
const {
  videoUrl, metadata, hasVideo, isLoading, error, isPlaying, volume,
  loadVideo, closeVideo,
} = useEditor()

// ── Toolbar ──
type ReupFeature = 'auto' | 'music'
const activeFeature = ref<ReupFeature>('auto')
const toolbarItems: { id: ReupFeature; label: string; icon: any }[] = [
  { id: 'auto',  label: 'Reup', icon: Repeat },
  { id: 'music', label: 'Nhạc',    icon: Music },
]
const showSplit = ref(false)

// ── Filter State ──
const mirror = ref(REUP_DEFAULTS.mirror)
const crop = ref(REUP_DEFAULTS.crop)
const cropX = ref(REUP_DEFAULTS.cropX)
const cropY = ref(REUP_DEFAULTS.cropY)
const noise = ref(REUP_DEFAULTS.noise)
const rotate = ref(REUP_DEFAULTS.rotate)
const lensDistortion = ref(REUP_DEFAULTS.lensDistortion)
const speed = ref(REUP_DEFAULTS.speed)
const audioEvade = ref(REUP_DEFAULTS.audioEvade)
const removeAudio = ref(false)
const applyHDR = ref(false)
const colorGrading = ref<ColorGradingStyle>(REUP_DEFAULTS.colorGrading)
const glow = ref(REUP_DEFAULTS.glow)
const volumeBoost = ref(REUP_DEFAULTS.volumeBoost)
const frameTemplate = ref<FrameTemplate>(REUP_DEFAULTS.frameTemplate)
const titleTemplate = ref<TitleTemplate>(REUP_DEFAULTS.titleTemplate)
const titleText = ref(REUP_DEFAULTS.titleText)
const descText = ref(REUP_DEFAULTS.descText)
const titleOffsetX = ref(0)  // Title X offset (px) — draggable
const titleOffsetY = ref(0)  // Title Y offset (px) — draggable
const descOffsetX = ref(0)   // Desc X offset (px) — draggable independently
const descOffsetY = ref(0)   // Desc Y offset (px) — draggable independently
const titleFontSize = ref(24) // Title font size (px)
const descFontSize = ref(14)  // Desc font size (px)
const textFont = ref('Inter') // Title font family
const descFont = ref('Inter') // Description font family
const textColor = ref('#ffffff') // Text color
const autoTitle = ref(false) // Auto-fill title from video filename
const currentVideoPath = ref('') // Track current video file path
const splitMode = ref<SplitMode>('none')

// New features
const borderWidth = ref(REUP_DEFAULTS.borderWidth)
const borderColor = ref(REUP_DEFAULTS.borderColor)
const zoomEffect = ref(REUP_DEFAULTS.zoomEffect)
const zoomIntensity = ref(REUP_DEFAULTS.zoomIntensity)
const logoPath = ref(REUP_DEFAULTS.logoPath)
const logoPosition = ref<LogoPosition>(REUP_DEFAULTS.logoPosition)
const logoSize = ref(REUP_DEFAULTS.logoSize)
// Pixel-level anti-detect (from Chế Độ 1)
const pixelEnlarge = ref(REUP_DEFAULTS.pixelEnlarge)
const chromaShuffle = ref(REUP_DEFAULTS.chromaShuffle)
const rgbDrift = ref(REUP_DEFAULTS.rgbDrift)
// Advanced anti-detect
const frameJitter = ref(REUP_DEFAULTS.frameJitter)
const gammaShift = ref(REUP_DEFAULTS.gammaShift)
const microColorCycle = ref(REUP_DEFAULTS.microColorCycle)
const dctNoise = ref(REUP_DEFAULTS.dctNoise)

// ── LocalStorage Persistence ──
// Auto-save all effect settings so they persist across app restarts
const SETTINGS_STORAGE_KEY = 'aurasplit_reup_settings'

// Collect all persistable settings into one object
function getSettingsSnapshot() {
  return {
    mirror: mirror.value, crop: crop.value, cropX: cropX.value, cropY: cropY.value,
    noise: noise.value, rotate: rotate.value, lensDistortion: lensDistortion.value,
    speed: speed.value, audioEvade: audioEvade.value, removeAudio: removeAudio.value,
    applyHDR: applyHDR.value, colorGrading: colorGrading.value, glow: glow.value,
    volumeBoost: volumeBoost.value, frameTemplate: frameTemplate.value,
    titleTemplate: titleTemplate.value, titleText: titleText.value, descText: descText.value,
    titleFontSize: titleFontSize.value, descFontSize: descFontSize.value,
    textFont: textFont.value, descFont: descFont.value, textColor: textColor.value,
    autoTitle: autoTitle.value,
    borderWidth: borderWidth.value, borderColor: borderColor.value,
    zoomEffect: zoomEffect.value, zoomIntensity: zoomIntensity.value,
    logoPosition: logoPosition.value, logoSize: logoSize.value,
    pixelEnlarge: pixelEnlarge.value, chromaShuffle: chromaShuffle.value, rgbDrift: rgbDrift.value,
    frameJitter: frameJitter.value, gammaShift: gammaShift.value,
    microColorCycle: microColorCycle.value, dctNoise: dctNoise.value,
  }
}

// Restore settings from localStorage on init
function restoreSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved.mirror !== undefined) mirror.value = saved.mirror
    if (saved.crop !== undefined) crop.value = saved.crop
    if (saved.cropX !== undefined) cropX.value = saved.cropX
    if (saved.cropY !== undefined) cropY.value = saved.cropY
    if (saved.noise !== undefined) noise.value = saved.noise
    if (saved.rotate !== undefined) rotate.value = saved.rotate
    if (saved.lensDistortion !== undefined) lensDistortion.value = saved.lensDistortion
    if (saved.speed !== undefined) speed.value = saved.speed
    if (saved.audioEvade !== undefined) audioEvade.value = saved.audioEvade
    if (saved.removeAudio !== undefined) removeAudio.value = saved.removeAudio
    if (saved.applyHDR !== undefined) applyHDR.value = saved.applyHDR
    if (saved.colorGrading !== undefined) colorGrading.value = saved.colorGrading
    if (saved.glow !== undefined) glow.value = saved.glow
    if (saved.volumeBoost !== undefined) volumeBoost.value = saved.volumeBoost
    if (saved.frameTemplate !== undefined) frameTemplate.value = saved.frameTemplate
    if (saved.titleTemplate !== undefined) titleTemplate.value = saved.titleTemplate
    if (saved.titleText !== undefined) titleText.value = saved.titleText
    if (saved.descText !== undefined) descText.value = saved.descText
    if (saved.titleFontSize !== undefined) titleFontSize.value = saved.titleFontSize
    if (saved.descFontSize !== undefined) descFontSize.value = saved.descFontSize
    if (saved.textFont !== undefined) textFont.value = saved.textFont
    if (saved.descFont !== undefined) descFont.value = saved.descFont
    if (saved.textColor !== undefined) textColor.value = saved.textColor
    if (saved.autoTitle !== undefined) autoTitle.value = saved.autoTitle
    if (saved.borderWidth !== undefined) borderWidth.value = saved.borderWidth
    if (saved.borderColor !== undefined) borderColor.value = saved.borderColor
    if (saved.zoomEffect !== undefined) zoomEffect.value = saved.zoomEffect
    if (saved.zoomIntensity !== undefined) zoomIntensity.value = saved.zoomIntensity
    if (saved.logoPosition !== undefined) logoPosition.value = saved.logoPosition
    if (saved.logoSize !== undefined) logoSize.value = saved.logoSize
    if (saved.pixelEnlarge !== undefined) pixelEnlarge.value = saved.pixelEnlarge
    if (saved.chromaShuffle !== undefined) chromaShuffle.value = saved.chromaShuffle
    if (saved.rgbDrift !== undefined) rgbDrift.value = saved.rgbDrift
    if (saved.frameJitter !== undefined) frameJitter.value = saved.frameJitter
    if (saved.gammaShift !== undefined) gammaShift.value = saved.gammaShift
    if (saved.microColorCycle !== undefined) microColorCycle.value = saved.microColorCycle
    if (saved.dctNoise !== undefined) dctNoise.value = saved.dctNoise

  } catch (e) {
    // silently ignore restore errors
  }
}

// Auto-save on any change (debounced 500ms)
let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveSettings() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(getSettingsSnapshot()))
    } catch (e) { /* quota exceeded — ignore */ }
  }, 500)
}

// Watch all settings refs
watch([
  mirror, crop, cropX, cropY, noise, rotate, lensDistortion, speed, audioEvade,
  removeAudio, applyHDR, colorGrading, glow, volumeBoost, frameTemplate,
  titleTemplate, titleText, descText, titleFontSize, descFontSize,
  textFont, descFont, textColor, autoTitle,
  borderWidth, borderColor, zoomEffect, zoomIntensity,
  logoPosition, logoSize,
  pixelEnlarge, chromaShuffle, rgbDrift,
  frameJitter, gammaShift, microColorCycle, dctNoise,
], saveSettings)

// Restore on init
restoreSettings()

// Enhance — visual overlay features
const overlayPath = ref('')       // Overlay folder path
const overlayOpacity = ref(60)    // 0-100 opacity
const overlayFiles = ref<string[]>([])  // scanned overlay files from folder
const overlayBlink = ref(false)   // Auto blink on/off
const overlayBlinkSpeed = ref(0.5) // Flash duration in seconds (how long each flash lasts)
const overlayInterval = ref(3)    // Flash interval in seconds (every N seconds from start)
const overlayIntervalEnabled = ref(false) // Interval mode on/off
const overlayVisible = ref(true)  // Current blink state (true=show, false=hide)
let overlayBlinkTimer: ReturnType<typeof setInterval> | null = null
const bgBlur = ref(false)        // Background mờ đằng sau
const bgBlurAmount = ref(40)     // Blur intensity (px) 5-80
const bgVideoRef = ref<HTMLVideoElement | null>(null)
const overlayVideoRef = ref<HTMLVideoElement | null>(null)

// Frame Interleave
const interleaveEnabled = ref(false)
const interleaveFolderPath = ref('')
const interleaveWarmup = ref(5)
const interleaveRatio = ref(5)

// Split Part
const splitEnabled = ref(false)
const splitDuration = ref(150)
const showSplitPart = ref(false)
const splitInputPath = ref('')
const splitVideoCount = ref(0)
const splitIsSplitting = ref(false)
const splitShowTitle = ref(true)
const splitShowPart = ref(true)
const splitVideoDuration = ref(0)
const reupPanelKey = ref(0)

function resetAllReup() {
  // Clear saved settings
  localStorage.removeItem(SETTINGS_STORAGE_KEY)
  // Visual Filters
  mirror.value = REUP_DEFAULTS.mirror
  crop.value = REUP_DEFAULTS.crop
  cropX.value = REUP_DEFAULTS.cropX
  cropY.value = REUP_DEFAULTS.cropY
  noise.value = REUP_DEFAULTS.noise
  rotate.value = REUP_DEFAULTS.rotate
  lensDistortion.value = REUP_DEFAULTS.lensDistortion
  colorGrading.value = REUP_DEFAULTS.colorGrading
  glow.value = REUP_DEFAULTS.glow
  // Frame & Effects
  borderWidth.value = REUP_DEFAULTS.borderWidth
  borderColor.value = REUP_DEFAULTS.borderColor
  zoomEffect.value = REUP_DEFAULTS.zoomEffect
  zoomIntensity.value = REUP_DEFAULTS.zoomIntensity
  pixelEnlarge.value = REUP_DEFAULTS.pixelEnlarge
  chromaShuffle.value = REUP_DEFAULTS.chromaShuffle
  rgbDrift.value = REUP_DEFAULTS.rgbDrift
  frameJitter.value = REUP_DEFAULTS.frameJitter
  gammaShift.value = REUP_DEFAULTS.gammaShift
  microColorCycle.value = REUP_DEFAULTS.microColorCycle
  dctNoise.value = REUP_DEFAULTS.dctNoise
  // Audio
  speed.value = REUP_DEFAULTS.speed
  audioEvade.value = REUP_DEFAULTS.audioEvade
  removeAudio.value = false
  volumeBoost.value = REUP_DEFAULTS.volumeBoost
  // HDR
  applyHDR.value = false
  // Title
  titleText.value = ''
  descText.value = ''
  titleOffsetX.value = 0; titleOffsetY.value = 0
  descOffsetX.value = 0; descOffsetY.value = 0
  // Logo
  logoPath.value = ''
  logoSize.value = REUP_DEFAULTS.logoSize
  // Split
  splitEnabled.value = false
  splitDuration.value = 150
  splitShowTitle.value = true
  splitShowPart.value = true
  splitInputPath.value = ''
  splitVideoCount.value = 0
  splitVideoDuration.value = 0
  // Force remount ReupPanel to clear folder/scan/log state
  reupPanelKey.value++
}

const splitEstimate = computed(() => {
  if (!splitInputPath.value) return ''
  if (splitVideoCount.value > 0) {
    return `📂 ${splitVideoCount.value} video trong folder`
  }
  if (splitVideoDuration.value > 0) {
    const dur = splitVideoDuration.value
    const mins = Math.floor(dur / 60)
    const secs = Math.round(dur % 60)
    const parts = Math.ceil(dur / splitDuration.value)
    return `⏱ ${mins}m${secs}s — ước tính ${parts} parts`
  }
  return `📄 1 video`
})

async function pickSplitInput() {
  const api = (window as any).electronAPI
  const result = await api.selectFolder()
  if (result) {
    splitInputPath.value = result
    splitEnabled.value = true
    // Scan folder for video count
    try {
      const scan = await api.splitScanFolder(result)
      splitVideoCount.value = scan?.count || 0
    } catch { splitVideoCount.value = 0 }
  }
}

async function pickSplitFile() {
  const api = (window as any).electronAPI
  const result = await api.selectFiles({
    title: 'Chọn video để chia part',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] }],
    properties: ['openFile'],
  })
  if (result?.length > 0) {
    splitInputPath.value = result[0]
    splitVideoCount.value = 0 // single file
    splitEnabled.value = true
    // Get duration
    try {
      const durResult = await api.splitGetDuration(result[0])
      splitVideoDuration.value = durResult?.duration || 0
    } catch { splitVideoDuration.value = 0 }
  }
}

async function startSplit() {
  if (!splitInputPath.value || splitIsSplitting.value) return
  const api = (window as any).electronAPI
  splitIsSplitting.value = true
  try {
    const result = await api.splitRun(splitInputPath.value, splitDuration.value, splitShowTitle.value, splitShowPart.value)
    if (result?.success) {
      exportStatus.value = `✅ Chia ${result.parts} parts xong!`
    } else {
      exportStatus.value = `❌ ${result?.error || 'Split failed'}`
    }
  } catch (e: any) {
    exportStatus.value = `❌ ${e.message}`
  } finally {
    splitIsSplitting.value = false
    setTimeout(() => { exportStatus.value = '' }, 8000)
  }
}

async function pickInterleaveFolder() {
  const files = await window.electronAPI.selectFiles({
    title: 'Chọn Video B (Frame Interleave)',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }],
  })
  if (files?.length) interleaveFolderPath.value = files[0]
}

// Overlay blink timer logic
watch([overlayBlink, overlayBlinkSpeed, overlayInterval, overlayIntervalEnabled], ([blink, flashDur, interval, useInterval]) => {
  if (overlayBlinkTimer) { clearInterval(overlayBlinkTimer); overlayBlinkTimer = null }
  if (blink) {
    if (useInterval) {
      // Interval mode: flash for flashDur every interval seconds
      overlayVisible.value = false
      overlayBlinkTimer = setInterval(() => {
        overlayVisible.value = true
        setTimeout(() => { overlayVisible.value = false }, (flashDur as number) * 1000)
      }, (interval as number) * 1000)
    } else {
      // Simple blink: toggle on/off at flashDur rate
      overlayBlinkTimer = setInterval(() => {
        overlayVisible.value = !overlayVisible.value
      }, (flashDur as number) * 1000)
    }
  } else {
    overlayVisible.value = true
  }
}, { immediate: true })

// Reframe — Scale X/Y/Z + Position
const videoZoom = ref(100)       // Z: 50–300 (%) uniform zoom
const videoScaleX = ref(100)     // X: 50–200 (%) stretch width
const videoScaleY = ref(100)     // Y: 50–200 (%) stretch height
const syncScale = ref(true)      // đồng bộ: lock X/Y together
const reframeEditMode = ref(false) // drag-to-pan mode

// Position (via drag)
const videoPosX = ref(0)         // translate X (px)
const videoPosY = ref(0)         // translate Y (px)

// Drag-to-pan state
const isDragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragStartPosX = 0
let dragStartPosY = 0

function onReframeDragStart(e: MouseEvent) {
  if (!reframeEditMode.value) return
  isDragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartPosX = videoPosX.value
  dragStartPosY = videoPosY.value
  e.preventDefault()
}
function onReframeDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  const totalScaleX = (videoZoom.value / 100) * (videoScaleX.value / 100)
  const totalScaleY = (videoZoom.value / 100) * (videoScaleY.value / 100)
  videoPosX.value = Math.round(dragStartPosX + (e.clientX - dragStartX) / totalScaleX)
  videoPosY.value = Math.round(dragStartPosY + (e.clientY - dragStartY) / totalScaleY)
}
function onReframeDragEnd() {
  isDragging.value = false
}

// ── Title drag-to-reposition ──
function onTitleDragStart(e: MouseEvent) {
  const startX = e.clientX
  const startY = e.clientY
  const startOX = titleOffsetX.value
  const startOY = titleOffsetY.value
  const onMove = (ev: MouseEvent) => {
    titleOffsetX.value = Math.round(startOX + ev.clientX - startX)
    titleOffsetY.value = Math.round(startOY + ev.clientY - startY)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ── Desc drag-to-reposition (independent from title) ──
function onDescDragStart(e: MouseEvent) {
  const startX = e.clientX
  const startY = e.clientY
  const startOX = descOffsetX.value
  const startOY = descOffsetY.value
  const onMove = (ev: MouseEvent) => {
    descOffsetX.value = Math.round(startOX + ev.clientX - startX)
    descOffsetY.value = Math.round(startOY + ev.clientY - startY)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ── Sub drag-to-reposition ──
function onSubDragStart(e: MouseEvent) {
  if (!subEditMode.value) return
  const startX = e.clientX
  const startY = e.clientY
  const startOX = subOffsetX.value
  const startOY = subOffsetY.value
  const onMove = (ev: MouseEvent) => {
    subOffsetX.value = Math.round(startOX + ev.clientX - startX)
    subOffsetY.value = Math.round(startOY + ev.clientY - startY)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// Sync X/Y when đồng bộ is on
watch(videoScaleX, (val) => {
  if (syncScale.value) videoScaleY.value = val
})
watch(videoScaleY, (val) => {
  if (syncScale.value) videoScaleX.value = val
})

// ── Ratio Dropdown ──
const showRatioDropdown = ref(false)
const ratioLabel = computed(() => {
  if (frameTemplate.value === 'none') return 'Tỉ lệ'
  const opt = FRAME_TEMPLATE_OPTIONS.find(o => o.value === frameTemplate.value)
  return opt ? opt.label : frameTemplate.value
})
function selectRatio(val: FrameTemplate) {
  frameTemplate.value = val
  showRatioDropdown.value = false
}
function closeDropdown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.ru-ratio-wrapper')) {
    showRatioDropdown.value = false
  }
}
onMounted(() => document.addEventListener('click', closeDropdown))
onUnmounted(() => document.removeEventListener('click', closeDropdown))

// ── Live Preview CSS ──
const {
  previewTransform, previewFilter, previewRgbDriftFilter, previewPlaybackRate,
  previewRatioClass, previewBorderStyle, previewZoomClass, previewMirrorClass, previewPixelClass,
  previewLogoInfo, previewCropZoom, previewCropBars, activeFilterCount,
} = useReupPreview({
  mirror, crop, cropX, cropY, noise, rotate, lensDistortion, applyHDR, speed, audioEvade,
  colorGrading, glow, volumeBoost, frameTemplate, titleTemplate, titleText, descText, splitMode,
  borderWidth, borderColor, zoomEffect, zoomIntensity,
  pixelEnlarge, chromaShuffle, rgbDrift,
  frameJitter, gammaShift, microColorCycle, dctNoise,
  logoPath, logoPosition, logoSize,
})

// ── Music ──
const musicPath = ref('')
const musicFileName = computed(() => {
  if (!musicPath.value) return ''
  return musicPath.value.split('\\').pop() || musicPath.value.split('/').pop() || ''
})
async function pickMusic() {
  const files = await window.electronAPI.selectFiles({
    title: 'Chọn nhạc',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }],
  })
  if (files?.length) musicPath.value = files[0]
}
function clearMusic() { musicPath.value = '' }

// ── Tab state for center column panels ──
type CenterTab = 'reframe' | 'textsub' | 'enhance' | 'interleave'
const activeTab = ref<CenterTab>('reframe')


// ── SUB (Subtitle) — extracted to composable ──
const {
  SUB_LANGUAGES,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showSub: _showSub, subLang, subRunning, subProgress, subStatus,
  subSegments, subSrtPath, subDetectedLang, subError,
  subEngine, subLogs, showSubLog,
  subStyle, subFontSize, subAnimation, subPosition,
  subOffsetX, subOffsetY, subEditMode,
  formatSubTime, startSubTranscribe: _startSub, stopSubTranscribe, exportSrt: _exportSrt,
} = useReupSubtitle()

// Wrappers pass currentVideoPath to composable
async function startSubTranscribe() { await _startSub(currentVideoPath.value) }
async function exportSrt() { await _exportSrt(currentVideoPath.value) }


// ── Video handlers ──
async function onLoadVideo(filePath: string) {
  currentVideoPath.value = filePath
  await loadVideo(filePath)
}

// Auto-fill titleText from video filename
function getFilenameTitle(fp: string): string {
  const name = fp.split('\\').pop()?.split('/').pop() || ''
  return name.replace(/\.[^.]+$/, '') // Remove extension
}
watch(autoTitle, (on) => {
  if (on && currentVideoPath.value) {
    titleText.value = getFilenameTitle(currentVideoPath.value)
  }
})
watch(currentVideoPath, (fp) => {
  if (autoTitle.value && fp) {
    titleText.value = getFilenameTitle(fp)
  }
})
const playbackTime = ref(0)
let subRafId = 0

// High-frequency subtitle time sync via requestAnimationFrame
function startSubTimeSync() {
  function tick() {
    const v = (videoPreviewRef.value as any)?.videoRef as HTMLVideoElement | undefined
    if (v && !v.paused) {
      playbackTime.value = v.currentTime
    }
    subRafId = requestAnimationFrame(tick)
  }
  subRafId = requestAnimationFrame(tick)
}
function stopSubTimeSync() {
  if (subRafId) { cancelAnimationFrame(subRafId); subRafId = 0 }
}

// Start/stop RAF sync when playing changes
watch(isPlaying, (playing) => {
  if (playing) startSubTimeSync()
  else stopSubTimeSync()
})

function onTimeUpdate(t: number) {
  playbackTime.value = t
  // Sync background blur video time
  const bg = bgVideoRef.value
  if (bg && Math.abs(bg.currentTime - t) > 0.3) {
    bg.currentTime = t
  }
  // Sync overlay video time
  const ov = overlayVideoRef.value
  if (ov && Math.abs(ov.currentTime - t) > 0.3) {
    ov.currentTime = t
  }
}

// ── Active subtitle for preview ──
const activeSubtitle = computed(() => {
  const t = playbackTime.value
  const segs = subSegments.value
  if (!segs.length) return null
  return segs.find(s => t >= s.start && t <= s.end) || null
})

const subPositionStyle = computed(() => {
  const pos = subPosition.value
  const ox = subOffsetX.value
  const oy = subOffsetY.value
  const style = subStyle.value

  // Font mapping from subStyle (matches assGenerator.ts)
  const fontMap: Record<string, string> = {
    bold_center: 'Montserrat, sans-serif',
    karaoke: 'Poppins, sans-serif',
    thin_minimal: 'Poppins, sans-serif',
    neon_glow: 'Bangers, cursive',
    dynamic_caption: 'Montserrat, sans-serif',
  }

  const base: Record<string, string> = {
    position: 'absolute',
    left: '50%',
    transform: `translateX(-50%) translate(${ox}px, ${oy}px)`,
    maxWidth: '90%',
    textAlign: 'center',
    pointerEvents: 'none',
    zIndex: '10',
    fontSize: subFontSize.value + 'px',
    fontWeight: style === 'thin_minimal' ? '600' : '700',
    fontFamily: fontMap[style] || 'Montserrat, sans-serif',
    lineHeight: '1.3',
    wordBreak: 'break-word',
    letterSpacing: style === 'neon_glow' ? '2px' : '0',
  }

  // Color & effects per style
  if (style === 'neon_glow') {
    base.color = '#00FFCC'
    base.textShadow = [
      '0 0 7px #00FFCC',
      '0 0 20px #00FFCC',
      '0 0 42px #00FFCC',
      '0 0 82px #00FFCC',
    ].join(', ')
  } else if (style === 'karaoke') {
    base.color = '#FFD700'
    base.textShadow = '2px 2px 8px rgba(0,0,0,0.9), -1px -1px 4px rgba(0,0,0,0.6)'
  } else if (style === 'thin_minimal') {
    base.color = '#F0FFFF'
    base.textShadow = '1px 1px 3px rgba(0,0,0,0.7)'
  } else {
    base.color = '#fff'
    base.textShadow = '2px 2px 6px rgba(0,0,0,0.9), -1px -1px 3px rgba(0,0,0,0.6)'
  }

  // Position
  if (pos === 'top') {
    base.top = '8%'
  } else if (pos === 'center') {
    base.top = '50%'
    base.transform = `translate(-50%, -50%) translate(${ox}px, ${oy}px)`
  } else {
    base.bottom = '12%'
  }
  return base
})

// CSS animation class for subtitle preview
const subAnimClass = computed(() => {
  const anim = subAnimation.value
  if (anim === 'none') return ''
  return `ru-sub-anim-${anim}`
})

// Dynamic Caption colors (matches assGenerator.ts WORD_POP_COLORS_ASS → CSS hex)
const DYNAMIC_COLORS = ['#FFD700', '#00E5FF', '#FF4081', '#76FF03', '#FF9100', '#448AFF', '#FF1744', '#E040FB']

// Deterministic random (matches assGenerator.ts makeRand)
function makeRand(text: string): () => number {
  let seed = 0
  for (let i = 0; i < text.length; i++) seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0
  return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 100) / 100 }
}

// Transform text for style — returns HTML string for dynamic caption, plain text otherwise
const activeSubtitleHtml = computed(() => {
  const sub = activeSubtitle.value
  if (!sub) return ''
  const style = subStyle.value
  const t = playbackTime.value

  if (style === 'dynamic_caption') {
    // Split into word groups (same logic as assGenerator.ts)
    const words = sub.text.split(/\s+/).filter(w => w.length > 0)
    if (words.length === 0) return ''
    const rand = makeRand(sub.text)

    const groups: Array<{ text: string; color: string }> = []
    let idx = 0, lastCI = -1
    while (idx < words.length) {
      const rem = words.length - idx
      const gsz = rem <= 2 ? rem : Math.max(1, Math.min(4, Math.floor(rand() * 4) + 1))
      const chunk = words.slice(idx, idx + gsz).join(' ')
      let ci = Math.floor(rand() * DYNAMIC_COLORS.length)
      if (ci === lastCI) ci = (ci + 1) % DYNAMIC_COLORS.length
      lastCI = ci
      groups.push({ text: chunk.toUpperCase(), color: DYNAMIC_COLORS[ci] })
      idx += gsz
    }

    // Determine which group is active based on time within segment
    const segDur = sub.end - sub.start
    const activeTime = segDur * 0.8
    const gInterval = groups.length > 1 ? activeTime / groups.length : activeTime
    const elapsed = t - sub.start
    const activeIdx = Math.min(groups.length - 1, Math.max(0, Math.floor(elapsed / gInterval)))

    return `<span style="color:${groups[activeIdx].color}">${groups[activeIdx].text}</span>`
  }

  // Non-dynamic styles: plain text
  if (style === 'bold_center') return sub.text.toUpperCase()
  return sub.text
})
function onDurationChange(_d: number) {}

// Sync bg video play/pause with main
watch(isPlaying, (playing) => {
  const bg = bgVideoRef.value
  if (!bg) return
  if (playing) bg.play().catch(() => {})
  else bg.pause()
})

// When bgBlur toggled ON, sync the bg video to current playback state
watch(bgBlur, async (enabled) => {
  if (!enabled) return
  await nextTick()  // wait for <video> to mount
  const bg = bgVideoRef.value
  if (!bg) return
  // Sync time with main video
  const mainVideo = document.querySelector('.vp-video') as HTMLVideoElement | null
  if (mainVideo) {
    bg.currentTime = mainVideo.currentTime
  }
  // Start playing if main is playing
  if (isPlaying.value) {
    bg.play().catch(() => {})
  }
})




// Sync overlay video play/pause
watch(isPlaying, (playing) => {
  const ov = overlayVideoRef.value
  if (!ov) return
  if (playing) ov.play().catch(() => {})
  else ov.pause()
})

// ── Logo picker (via electronAPI IPC bridge) ──
async function pickLogo() {
  const files = await window.electronAPI.selectFiles({
    title: 'Chọn logo',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
  })
  if (files?.length) logoPath.value = files[0]
}
function clearLogo() { logoPath.value = '' }

// Logo URL — convert file path to displayable media URL
const logoUrl = ref('')
watch(logoPath, async (path) => {
  if (!path) { logoUrl.value = ''; return }
  try { logoUrl.value = await window.electronAPI.getMediaUrl(path) }
  catch { logoUrl.value = '' }
})

// ── Overlay picker (select video/image file directly) ──
async function pickOverlay() {
  const files = await window.electronAPI.selectFiles({
    title: 'Chọn Overlay Video/Image',
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv', 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
    ],
  })
  if (!files?.length) return
  overlayPath.value = files[0]
  overlayFiles.value = [files[0]]
}
function clearOverlay() {
  overlayPath.value = ''
  overlayFiles.value = []
}
// First overlay file for preview — use electronAPI to get proper media URL
const firstOverlayUrl = ref('')
const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']
const isOverlayImage = computed(() => {
  const first = overlayFiles.value[0]
  return first ? imageExts.some(ext => first.toLowerCase().endsWith(ext)) : false
})
watch(() => overlayFiles.value[0], async (firstFile) => {
  if (!firstFile) { firstOverlayUrl.value = ''; return }
  try {
    firstOverlayUrl.value = await window.electronAPI.getMediaUrl(firstFile)
  } catch { firstOverlayUrl.value = '' }
})

// ── Apply Preset (1-click fill all refs from preset values) ──
function applyPreset(values: ReupPresetValues) {
  if (values.mirror !== undefined) mirror.value = values.mirror
  if (values.crop !== undefined) crop.value = values.crop
  if (values.cropX !== undefined) cropX.value = values.cropX
  if (values.cropY !== undefined) cropY.value = values.cropY
  if (values.noise !== undefined) noise.value = values.noise
  if (values.rotate !== undefined) rotate.value = values.rotate
  if (values.lensDistortion !== undefined) lensDistortion.value = values.lensDistortion
  if (values.speed !== undefined) speed.value = values.speed
  if (values.audioEvade !== undefined) audioEvade.value = values.audioEvade
  if (values.hdr !== undefined) applyHDR.value = values.hdr
  if (values.colorGrading !== undefined) colorGrading.value = values.colorGrading
  if (values.glow !== undefined) glow.value = values.glow
  if (values.volumeBoost !== undefined) volumeBoost.value = values.volumeBoost
  if (values.frameTemplate !== undefined) frameTemplate.value = values.frameTemplate
  if (values.titleTemplate !== undefined) titleTemplate.value = values.titleTemplate
  if (values.titleText !== undefined) titleText.value = values.titleText
  if (values.descText !== undefined) descText.value = values.descText
  if (values.borderWidth !== undefined) borderWidth.value = values.borderWidth
  if (values.borderColor !== undefined) borderColor.value = values.borderColor
  if (values.zoomEffect !== undefined) zoomEffect.value = values.zoomEffect
  if (values.zoomIntensity !== undefined) zoomIntensity.value = values.zoomIntensity
  if (values.logoPath !== undefined) logoPath.value = values.logoPath
  if (values.logoPosition !== undefined) logoPosition.value = values.logoPosition
  if (values.logoSize !== undefined) logoSize.value = values.logoSize
  if (values.pixelEnlarge !== undefined) pixelEnlarge.value = values.pixelEnlarge
  if (values.chromaShuffle !== undefined) chromaShuffle.value = values.chromaShuffle
  if (values.rgbDrift !== undefined) rgbDrift.value = values.rgbDrift
  if (values.frameJitter !== undefined) frameJitter.value = values.frameJitter
  if (values.gammaShift !== undefined) gammaShift.value = values.gammaShift
  if (values.microColorCycle !== undefined) microColorCycle.value = values.microColorCycle
  if (values.dctNoise !== undefined) dctNoise.value = values.dctNoise
}

// ── Direct video element control for speed & volume ──
const videoPreviewRef = ref<InstanceType<typeof VideoPreview> | null>(null)

watch([speed, volumeBoost], ([newSpeed, _newBoost]) => {
  const vp = videoPreviewRef.value
  if (!vp?.videoRef) return
  const video = vp.videoRef as HTMLVideoElement
  // Speed
  if (newSpeed !== 1.0 && video.playbackRate !== newSpeed) {
    video.playbackRate = newSpeed
  } else if (newSpeed === 1.0 && video.playbackRate !== 1.0) {
    video.playbackRate = 1.0
  }
  // Volume boost handled via GainNode in VideoPreview
}, { immediate: false })

// ── Export Single Video ──
const isExporting = ref(false)
const exportStatus = ref('')

async function exportVideo() {
  if (!currentVideoPath.value || isExporting.value) return

  const api = (window as any).electronAPI
  if (!api?.reupExport) {

    return
  }

  // Build config from current settings — ALL filters must be included
  const config = {
    singleFile: currentVideoPath.value,
    inputFolder: '',
    // Core 9 layers
    mirror: mirror.value,
    crop: crop.value,
    cropX: cropX.value,
    cropY: cropY.value,
    noise: noise.value,
    rotate: rotate.value,
    lensDistortion: lensDistortion.value,
    hdr: applyHDR.value,
    speed: speed.value,
    pitchShift: audioEvade.value,
    audioEvade: audioEvade.value,
    removeAudio: removeAudio.value,
    cleanMetadata: true,
    musicPath: musicPath.value,
    // Color & Glow
    colorGrading: colorGrading.value,
    glow: glow.value,
    volumeBoost: volumeBoost.value,
    // Frame effects
    frameTemplate: frameTemplate.value,
    borderWidth: borderWidth.value,
    borderColor: borderColor.value,
    zoomEffect: zoomEffect.value,
    zoomIntensity: zoomIntensity.value,
    // Pixel-level anti-detect
    pixelEnlarge: pixelEnlarge.value,
    chromaShuffle: chromaShuffle.value,
    rgbDrift: rgbDrift.value,
    frameJitter: frameJitter.value,
    gammaShift: gammaShift.value,
    microColorCycle: microColorCycle.value,
    dctNoise: dctNoise.value,
    // Title
    titleTemplate: titleTemplate.value,
    titleText: titleText.value,
    descText: descText.value,
    // Text styling
    textFont: textFont.value,
    titleFontSize: titleFontSize.value,
    descFontSize: descFontSize.value,
    textColor: textColor.value,
    titleOffsetX: titleOffsetX.value,
    titleOffsetY: titleOffsetY.value,
    descOffsetX: descOffsetX.value,
    descOffsetY: descOffsetY.value,
    // Logo
    logoPath: logoPath.value,
    logoPosition: logoPosition.value,
    logoSize: logoSize.value,
    // Split
    splitMode: splitMode.value,
    segmentLength: 15,
    // Subtitles
    srtPath: subSrtPath.value || '',
    subStyle: subStyle.value,
    subFontSize: subFontSize.value,
    subPosition: subPosition.value,
    subAnimation: subAnimation.value,
    subOffsetX: subOffsetX.value,
    subOffsetY: subOffsetY.value,
    // Preview container height for coordinate conversion to ASS PlayRes
    previewHeight: document.querySelector('.ru-frame-wrapper')?.clientHeight || 500,
    // Reframe
    reframeZoom: videoZoom.value,
    reframeScaleX: videoScaleX.value,
    reframeScaleY: videoScaleY.value,
    reframePosX: videoPosX.value,
    reframePosY: videoPosY.value,
    // Background blur
    bgBlur: bgBlur.value,
    bgBlurAmount: bgBlurAmount.value,
    // Video overlay
    overlayPath: overlayFiles.value[0] || '',
    overlayOpacity: overlayOpacity.value,
    overlayBlink: overlayBlink.value,
    overlayBlinkSpeed: overlayBlinkSpeed.value,
    overlayInterval: overlayInterval.value,
    // Frame Interleave
    interleaveEnabled: interleaveEnabled.value,
    interleaveFolderPath: interleaveFolderPath.value,
    interleaveWarmup: interleaveWarmup.value,
    interleaveRatio: interleaveRatio.value,
    splitEnabled: splitEnabled.value,
    splitDuration: splitDuration.value,
  }

  isExporting.value = true
  exportStatus.value = 'Đang chọn nơi lưu...'

  try {
    // Show Save As dialog with suggested filename
    const inputName = currentVideoPath.value.split('\\').pop()?.replace(/\.[^.]+$/, '') || 'output'
    const suggestedPath = `${inputName}_REUP.mp4`

    const savePath = await api.selectSavePath({
      title: 'Xuất Video — Chọn nơi lưu',
      defaultPath: suggestedPath,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })

    if (!savePath) {
      exportStatus.value = ''
      isExporting.value = false
      return
    }

    exportStatus.value = 'Đang xuất...'
    const result = await api.reupExport(config, savePath)
    if (result?.success) {
      exportStatus.value = `✅ Đã xuất: ${result.outputPath}`
      // Highlight exported file in Explorer
      if (api.showItemInFolder) api.showItemInFolder(result.outputPath)
    } else {
      exportStatus.value = `❌ ${result?.error || 'Xuất thất bại'}`
    }
  } catch (e: any) {
    exportStatus.value = `❌ ${e.message}`

  } finally {
    isExporting.value = false
    // Clear status after 8s
    setTimeout(() => { exportStatus.value = '' }, 8000)
  }
}
</script>

<template>
  <div class="reup-layout">
    <!-- SVG Grain Filter (noise preview) — intensity controlled by noise ref (0-100) -->
    <svg class="hidden-svg" width="0" height="0">
      <defs>
        <filter id="grain">
          <feTurbulence type="fractalNoise" :baseFrequency="(0.3 + noise * 0.007).toFixed(3)" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feBlend in="SourceGraphic" :mode="noise > 60 ? 'multiply' : 'overlay'" />
        </filter>
      </defs>
    </svg>

    <!-- Top Bar -->
    <header class="ru-topbar">
      <div class="ru-topbar-left">
        <div class="ru-logo"><Repeat :size="16" /></div>
        <span class="ru-title">Reup Video</span>

        <!-- Ratio Dropdown -->
        <div class="ru-ratio-wrapper">
          <button class="ru-ratio-btn" :class="{ active: frameTemplate !== 'none', open: showRatioDropdown }" @click.stop="showRatioDropdown = !showRatioDropdown">
            <MonitorSmartphone :size="12" />
            <span>{{ ratioLabel }}</span>
            <ChevronDown :size="10" class="ru-ratio-chevron" :class="{ open: showRatioDropdown }" />
          </button>
          <Transition name="dropdown">
            <div v-if="showRatioDropdown" class="ru-ratio-menu">
              <button
                v-for="opt in FRAME_TEMPLATE_OPTIONS" :key="opt.value"
                class="ru-ratio-option"
                :class="{ selected: frameTemplate === opt.value }"
                @click="selectRatio(opt.value)"
              >
                <span class="ru-ratio-opt-label">{{ opt.label }}</span>
                <span class="ru-ratio-opt-desc">{{ opt.desc }}</span>
              </button>
            </div>
          </Transition>
        </div>

        <!-- Music picker -->
        <div class="ru-path-item" @click="pickMusic">
          <Music :size="12" />
          <span class="ru-path-label">Nhạc</span>
          <span class="ru-path-value" :class="{ empty: !musicPath }">{{ musicFileName || 'Không' }}</span>
        </div>
        <button v-if="musicPath" class="ru-path-clear" @click.stop="clearMusic">✕</button>

        <div class="ru-hdr-toggle" :class="{ active: applyHDR }" @click="applyHDR = !applyHDR">
          <Sun :size="12" /><span>HDR</span>
        </div>
        <span class="ru-filter-badge">{{ activeFilterCount }} lớp</span>

        <!-- Chia Part toggle + popup -->
        <div class="ru-split-wrapper" style="position:relative;">
          <div class="ru-hdr-toggle" :class="{ active: splitEnabled }" @click="showSplitPart = !showSplitPart">
            <span>✂️</span><span>Chia Part</span>
          </div>
          <Transition name="fade">
            <div v-if="showSplitPart" class="ru-split-popup">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <span style="font-weight:600; font-size:13px;">✂️ Chia Part tự động</span>
                <button style="font-size:10px; padding:2px 8px; border-radius:4px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#aaa; cursor:pointer;" @click="splitInputPath=''; splitDuration=150; splitShowTitle=true; splitShowPart=true; splitVideoCount=0">🔄 Reset</button>
              </div>

              <!-- Title / Part toggles -->
              <div style="display:flex; gap:12px; margin-bottom:8px;">
                <label style="display:flex; align-items:center; gap:4px; cursor:pointer; font-size:11px;">
                  <input type="checkbox" v-model="splitShowTitle" />
                  🏷️ Tiêu đề
                </label>
                <label style="display:flex; align-items:center; gap:4px; cursor:pointer; font-size:11px;">
                  <input type="checkbox" v-model="splitShowPart" />
                  🔢 Part
                </label>
              </div>

              <!-- Input: Folder hoặc Video -->
              <div style="display:flex; gap:4px; margin-bottom:8px;">
                <button class="ruf-auto-btn" style="flex:1;" @click="pickSplitInput">
                  📁 Folder
                </button>
                <button class="ruf-auto-btn" style="flex:1;" @click="pickSplitFile">
                  🎬 Video
                </button>
              </div>
              <div v-if="splitInputPath" style="font-size:11px; color:#fff; font-weight:600; margin-bottom:6px; word-break:break-all;">
                → {{ splitInputPath.split('\\').pop() }}
              </div>

              <!-- Duration presets + custom -->
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px; flex-wrap:wrap;">
                <span style="font-size:11px; color:var(--text-muted);">Mỗi part</span>
                <select v-model.number="splitDuration" class="ruf-select" style="max-width:80px;">
                  <option :value="30">30s</option>
                  <option :value="60">1 phút</option>
                  <option :value="120">2 phút</option>
                  <option :value="150">2.5p ⭐</option>
                  <option :value="180">3 phút</option>
                  <option :value="300">5 phút</option>
                </select>
                <span style="font-size:11px; color:var(--text-muted);">hoặc</span>
                <input type="number" v-model.number="splitDuration" min="10" max="600" step="10" class="ruf-select" style="max-width:60px; text-align:center;" />
                <span style="font-size:11px; color:var(--text-muted);">giây</span>
              </div>

              <!-- Estimate -->
              <div v-if="splitEstimate" style="font-size:11px; color:var(--text-muted); padding:4px 0; border-top:1px solid rgba(255,255,255,0.08);">
                {{ splitEstimate }}
              </div>

              <!-- Start button -->
              <button
                v-if="splitInputPath"
                class="ru-export-btn"
                style="width:100%; margin-top:8px;"
                :disabled="splitIsSplitting"
                @click="startSplit"
              >
                {{ splitIsSplitting ? '⏳ Đang chia...' : '▶ Bắt đầu chia Part' }}
              </button>
            </div>
          </Transition>
        </div>
      </div>
      <div class="ru-topbar-right">
        <button class="ru-hdr-toggle" @click="resetAllReup" title="Reset tất cả về mặc định" style="color:#ff6b6b;">
          🔄 <span>Reset</span>
        </button>
        <span v-if="metadata" class="ru-meta-badge">{{ metadata.width }}×{{ metadata.height }}</span>
        <span v-if="hasVideo" class="ru-live-badge">XEM TRƯỜC</span>
        <button
          v-if="hasVideo"
          class="ru-export-btn"
          :class="{ exporting: isExporting }"
          :disabled="isExporting"
          @click="exportVideo"
          :title="isExporting ? 'Đang xuất...' : 'Xuất video với tất cả hiệu ứng' + (subSrtPath ? ' + phụ đề' : '')"
        >
          <Download :size="13" :class="{ spin: isExporting }" />
          <span>{{ isExporting ? 'Đang xuất...' : 'Xuất' }}</span>
        </button>
      </div>
      <div v-if="exportStatus" class="ru-export-status">{{ exportStatus }}</div>
    </header>

    <!-- Main 3-Column -->
    <div class="ru-main">
      <!-- LEFT: Toolbar -->
      <ReupToolbar
        :activeFeature="activeFeature"
        :toolbarItems="toolbarItems"
        :musicFileName="musicFileName"
        @update:activeFeature="activeFeature = $event"
        @clear-music="clearMusic"
      />

      <!-- CENTER: Preview -->
      <main class="ru-center">
        <div v-if="isLoading" class="ru-loading">
          <Loader2 :size="24" class="spin" /><span>Đang tải video...</span>
        </div>
        <div v-if="error" class="ru-error">{{ error }}</div>

        <ReupDropzone v-if="!hasVideo && !isLoading" @load-video="onLoadVideo" />

        <div v-if="hasVideo" class="ru-preview" :class="{ 'bg-blur-active': bgBlur }">
          <!-- Background Blur Layer — fills ENTIRE preview area -->
          <video
            v-if="bgBlur && videoUrl"
            ref="bgVideoRef"
            :src="videoUrl"
            class="ru-bg-blur"
            :style="{ '--bg-blur-amount': bgBlurAmount + 'px' }"
            muted
            playsinline
            preload="auto"
          />
          <div class="ru-frame-wrapper" :class="[previewRatioClass, previewZoomClass]"
            :style="{ '--zoom-intensity': zoomIntensity }">
            <div class="ru-preview-fx"
              :class="[previewMirrorClass, previewPixelClass, { 'reframe-edit': reframeEditMode }]"
              :style="{
                '--pv-transform': previewTransform,
                '--pv-filter': previewFilter,
                '--pv-rgb-filter': previewRgbDriftFilter,
                '--reframe-sx': (videoZoom * videoScaleX / 10000) * previewCropZoom.x,
                '--reframe-sy': (videoZoom * videoScaleY / 10000) * previewCropZoom.y,
                '--reframe-x': videoPosX + 'px',
                '--reframe-y': videoPosY + 'px',
              }"
              @mousedown="onReframeDragStart"
              @mousemove="onReframeDragMove"
              @mouseup="onReframeDragEnd"
              @mouseleave="onReframeDragEnd"
            >
              <VideoPreview
                ref="videoPreviewRef"
                :src="videoUrl!"
                :isPlaying="isPlaying"
                :volume="volume"
                :playbackRate="previewPlaybackRate"
                :volumeBoost="volumeBoost"
                :cropClipPath="previewCropBars || undefined"
                @update:isPlaying="isPlaying = $event"
                @update:volume="volume = $event"
                @timeupdate="onTimeUpdate"
                @durationchange="onDurationChange"
              />
              <!-- Subtitle preview overlay -->
              <Transition :name="subAnimClass" appear mode="out-in">
                <div v-if="activeSubtitle" class="ru-sub-overlay" :style="subPositionStyle" :key="activeSubtitle.start + '-' + activeSubtitle.text">
                  <span class="ru-sub-inner" v-html="activeSubtitleHtml"></span>
                </div>
              </Transition>
            </div>
            <!-- Overlay preview (video or image) — respects blink visibility -->
            <video
              v-if="firstOverlayUrl && videoUrl && !isOverlayImage && overlayVisible"
              ref="overlayVideoRef"
              :src="firstOverlayUrl"
              class="ru-overlay-video"
              :style="{ opacity: overlayOpacity / 100 }"
              muted
              playsinline
              preload="auto"
              loop
            />
            <img
              v-if="firstOverlayUrl && videoUrl && isOverlayImage && overlayVisible"
              :src="firstOverlayUrl"
              class="ru-overlay-video"
              :style="{ opacity: overlayOpacity / 100 }"
              alt="overlay"
            />
            <!-- Border overlay -->
            <div v-if="borderWidth > 0" class="ru-border-overlay" :style="previewBorderStyle" />

            <!-- SmartCrop applied via clip-path on ru-preview-fx (no overlay divs) -->

            <!-- Logo overlay preview (actual image) — INSIDE frame-wrapper -->
            <div v-if="previewLogoInfo && logoUrl" class="ru-logo-overlay" :class="previewLogoInfo.position">
              <img :src="logoUrl" class="ru-logo-img" :style="{ width: previewLogoInfo.size + '%' }" alt="logo" />
            </div>

            <!-- Title (TEXT ON SCREEN) overlay — independent from SUB -->
            <div v-if="titleText" class="ru-title-overlay center"
              :style="{ transform: `translate(${titleOffsetX}px, ${titleOffsetY}px)` }"
              @mousedown.prevent="onTitleDragStart"
            >
              <div class="ru-title-text" :style="{
                fontFamily: textFont,
                fontWeight: '700',
                fontSize: titleFontSize + 'px',
                color: textColor,
                textShadow: '2px 2px 6px rgba(0,0,0,0.8), -1px -1px 3px rgba(0,0,0,0.5)',
              }">{{ titleText }}</div>
            </div>

            <!-- Desc (Mô tả) overlay — independent, draggable -->
            <div v-if="descText" class="ru-title-overlay bottom"
              :style="{ transform: `translate(${descOffsetX}px, ${descOffsetY}px)` }"
              @mousedown.prevent="onDescDragStart"
            >
              <div class="ru-desc-text" :style="{
                fontFamily: descFont,
                fontSize: descFontSize + 'px',
                color: textColor,
                textShadow: '1px 1px 4px rgba(0,0,0,0.7)',
              }">{{ descText }}</div>
            </div>

            <!-- Subtitle drag overlay (when sub edit mode active) -->
            <div v-if="subEditMode && subSegments.length" class="ru-sub-drag-overlay"
              @mousedown.prevent="onSubDragStart"
            >
              <span class="ru-sub-drag-hint">✋ Kéo để di chuyển subtitles</span>
            </div>
          </div>

          <button class="ru-cancel-video" @click="closeVideo" title="Close video"><X :size="14" /></button>
        </div>

        <!-- ═══════ TAB BAR + TAB CONTENT ═══════ -->
        <div class="ru-tab-bar">
          <button class="ru-tab" :class="{ active: activeTab === 'reframe' }" @click="activeTab = 'reframe'">
            🔍 Đổi khung
          </button>
          <button class="ru-tab" :class="{ active: activeTab === 'textsub' }" @click="activeTab = 'textsub'">
            📝 Chữ & Phụ đề
            <span v-if="titleText || descText || subSegments.length" class="ru-tab-dot"></span>
          </button>
          <button class="ru-tab" :class="{ active: activeTab === 'enhance' }" @click="activeTab = 'enhance'">
            ✨ Nâng cao
            <span v-if="logoPath || overlayPath || bgBlur || pixelEnlarge || chromaShuffle || rgbDrift" class="ru-tab-dot"></span>
          </button>
          <button class="ru-tab" :class="{ active: activeTab === 'interleave' }" @click="activeTab = 'interleave'">
            🔀 Trộn
            <span v-if="interleaveEnabled" class="ru-tab-dot"></span>
          </button>
        </div>

        <div class="ru-tab-scroll">
          <!-- TAB: Reframe -->
          <div v-show="activeTab === 'reframe'" class="ru-tab-panel">
            <!-- Drag mode -->
            <button class="ruf-edit-toggle" :class="{ active: reframeEditMode }" @click="reframeEditMode = !reframeEditMode">
            {{ reframeEditMode ? '✋ Đang kéo — Click tắt' : '🖱️ Bật kéo thả di chuyển' }}
            </button>

            <!-- Sync toggle -->
            <label class="ruf-check ruf-sync-toggle">
            <input type="checkbox" v-model="syncScale" />
            🔗 Đồng bộ X/Y
            <span class="ruf-sync-hint">{{ syncScale ? '(khóa tỷ lệ)' : '(tự do)' }}</span>
            </label>

            <!-- Z: Zoom -->
            <div class="ruf-slider-row">
            <span class="ruf-slider-label">🔍 Z</span>
            <input type="range" min="50" max="300" step="5" v-model.number="videoZoom" class="ruf-slider" />
            <span class="ruf-val">{{ videoZoom }}%</span>
            </div>
            <!-- X: Scale Width -->
            <div class="ruf-slider-row">
            <span class="ruf-slider-label">↔️ X</span>
            <input type="range" min="50" max="200" step="5" v-model.number="videoScaleX" class="ruf-slider" />
            <span class="ruf-val">{{ videoScaleX }}%</span>
            </div>
            <!-- Y: Scale Height -->
            <div class="ruf-slider-row">
            <span class="ruf-slider-label">↕️ Y</span>
            <input type="range" min="50" max="200" step="5" v-model.number="videoScaleY" class="ruf-slider" />
            <span class="ruf-val">{{ videoScaleY }}%</span>
            </div>

            <!-- Position display (from drag) -->
            <div v-if="videoPosX !== 0 || videoPosY !== 0" class="ruf-pos-display">
            📌 Vị trí: X={{ videoPosX }}px, Y={{ videoPosY }}px
            </div>

            <button v-if="videoZoom !== 100 || videoScaleX !== 100 || videoScaleY !== 100 || videoPosX !== 0 || videoPosY !== 0" class="ruf-reset-btn" @click="videoZoom = 100; videoScaleX = 100; videoScaleY = 100; videoPosX = 0; videoPosY = 0; reframeEditMode = false">
            🔄 Reset
            </button>
          </div>

          <!-- TAB: Text & Sub -->
          <div v-show="activeTab === 'textsub'" class="ru-tab-panel">
            <div class="ruf-sub-heading">📝 TEXT</div>
            <!-- Auto title checkbox -->
            <label class="ruf-check" style="margin-bottom:4px;">
            <input type="checkbox" v-model="autoTitle" />
            📌 Tự động lấy tiêu đề từ tên video
            </label>
            <div class="ruf-input-row">
            <label>Tiêu đề</label>
            <input v-model="titleText" placeholder="Auto: filename" class="ruf-input" />
            </div>
            <div class="ruf-slider-row">
            <span style="font-size:11px;">📏 Cỡ chữ</span>
            <input type="range" min="10" max="48" step="1" v-model.number="titleFontSize" class="ruf-slider" />
            <span class="ruf-val">{{ titleFontSize }}px</span>
            </div>
            <div class="ruf-font-grid" style="margin-top:2px;">
            <button v-for="f in TEXT_FONTS" :key="'t-'+f"
            class="ruf-font-btn" :class="{ active: textFont === f }"
            :style="{ fontFamily: f }" @click="textFont = f"
            >{{ f }}</button>
            </div>

            <div style="height:1px; background:var(--border-default); margin:6px 0;" />

            <div class="ruf-input-row">
            <label>Mô tả</label>
            <input v-model="descText" placeholder="e.g. Please comment below" class="ruf-input" />
            </div>
            <div class="ruf-slider-row">
            <span style="font-size:11px;">📏 Cỡ chữ</span>
            <input type="range" min="8" max="36" step="1" v-model.number="descFontSize" class="ruf-slider" />
            <span class="ruf-val">{{ descFontSize }}px</span>
            </div>
            <div class="ruf-font-grid" style="margin-top:2px;">
            <button v-for="f in TEXT_FONTS" :key="'d-'+f"
            class="ruf-font-btn" :class="{ active: descFont === f }"
            :style="{ fontFamily: f }" @click="descFont = f"
            >{{ f }}</button>
            </div>
            <!-- Color Picker + Reset -->
            <div class="ruf-slider-row" style="margin-top:2px;">
            <span style="font-size:11px;">🎨 Màu</span>
            <input type="color" v-model="textColor" class="ruf-color-input" />
            <span class="ruf-val">{{ textColor }}</span>
            <button v-if="titleOffsetX !== 0 || titleOffsetY !== 0 || descOffsetX !== 0 || descOffsetY !== 0" class="ruf-reset-btn" style="margin:0;" @click="titleOffsetX = 0; titleOffsetY = 0; descOffsetX = 0; descOffsetY = 0">
            🔄 Reset
            </button>
            </div>
            <div style="height:1px; background:var(--border-default); margin:6px 0;"></div>
            <div class="ruf-sub-heading">🎬 SUB <span v-if="subSegments.length" class="ruf-badge">{{ subSegments.length }} segs</span></div>
            <!-- Language selector -->
            <div class="sub-row">
            <span class="sub-label">🌍 Language</span>
            <select v-model="subLang" class="ruf-select sub-select" :disabled="subRunning">
            <option v-for="l in SUB_LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
            </select>
            </div>

            <!-- Style selector grid -->
            <div class="sub-style-grid">
            <div
            v-for="opt in TITLE_TEMPLATE_OPTIONS"
            :key="opt.value"
            class="sub-style-card"
            :class="{ active: subStyle === opt.value }"
            @click="subStyle = opt.value"
            >
            <span class="sub-style-icon">{{ opt.label.split(' ')[0] }}</span>
            <span class="sub-style-name">{{ opt.label.replace(/^\S+\s/, '') }}</span>
            <span class="sub-style-desc">{{ opt.desc }}</span>
            </div>
            </div>

            <!-- Font size slider -->
            <div class="sub-size-row">
            <span class="sub-label">📏 Size</span>
            <input
            type="range"
            class="sub-size-slider"
            v-model.number="subFontSize"
            min="10" max="60" step="1"
            />
            <span class="sub-size-value">{{ subFontSize }}px</span>
            </div>

            <!-- Animation selector -->
            <div class="sub-row">
            <span class="sub-label">🎬 Animation</span>
            <select v-model="subAnimation" class="ruf-select sub-select">
            <option v-for="a in SUB_ANIMATION_OPTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
            </div>

            <!-- Position selector -->
            <div class="sub-row">
            <span class="sub-label">📍 Position</span>
            <select v-model="subPosition" class="ruf-select sub-select">
            <option v-for="p in SUB_POSITION_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
            </div>

            <!-- Drag toggle + offset display -->
            <div class="sub-row">
            <button class="ruf-edit-toggle" :class="{ active: subEditMode }" @click="subEditMode = !subEditMode">
            {{ subEditMode ? '✋ Đang kéo — Click tắt' : '🖱️ Kéo thả vị trí sub' }}
            </button>
            </div>
            <div v-if="subOffsetX !== 0 || subOffsetY !== 0" class="sub-row">
            <span class="sub-label">📍 Offset</span>
            <span class="sub-detected">X:{{ subOffsetX }} Y:{{ subOffsetY }}</span>
            <button class="sub-btn-mini" @click="subOffsetX = 0; subOffsetY = 0" title="Reset">🔄</button>
            </div>

            <!-- Transcribe button -->
            <div class="sub-row">
            <button
            v-if="!subRunning"
            class="sub-btn sub-btn-primary"
            :disabled="!currentVideoPath"
            @click="startSubTranscribe"
            >
            🎤 Generate Subtitles
            </button>
            <button v-else class="sub-btn sub-btn-stop" @click="stopSubTranscribe">
            ⬛ Stop
            </button>
            </div>

            <!-- Progress bar -->
            <div v-if="subRunning || subProgress > 0" class="sub-progress-wrap">
            <div class="sub-progress-bar">
            <div class="sub-progress-fill" :style="{ width: subProgress + '%' }"></div>
            </div>
            <span class="sub-progress-text">{{ subProgress }}%</span>
            </div>

            <!-- Status -->
            <div v-if="subStatus" class="sub-status">{{ subStatus }}</div>
            <div v-if="subError" class="sub-status sub-error">❌ {{ subError }}</div>

            <!-- Engine indicator -->
            <div v-if="subEngine" class="sub-row">
            <span class="sub-label">🔧 Engine</span>
            <span class="sub-detected">{{ subEngine === 'whisper' ? '🚀 WhisperX' : subEngine === 'whisperx' ? '🚀 WhisperX' : '🧠 Qwen3-ASR' }}</span>
            </div>

            <!-- System Log toggle -->
            <div v-if="subLogs.length" class="sub-row">
            <button class="sub-btn-mini sub-log-toggle" @click="showSubLog = !showSubLog">
            {{ showSubLog ? '🔽' : '▶️' }} System Log ({{ subLogs.length }})
            </button>
            </div>

            <!-- System Log panel -->
            <div v-if="showSubLog && subLogs.length" class="sub-log-panel">
            <div class="sub-log-content" ref="subLogContainer">
            <div v-for="(log, i) in subLogs" :key="i" class="sub-log-line">{{ log }}</div>
            </div>
            </div>

            <!-- Detected language -->
            <div v-if="subDetectedLang" class="sub-row">
            <span class="sub-label">Detected</span>
            <span class="sub-detected">{{ subDetectedLang }}</span>
            </div>

            <!-- SRT Preview -->
            <div v-if="subSegments.length" class="sub-preview">
            <div class="sub-preview-header">
            📝 Subtitle Preview ({{ subSegments.length }} segments)
            </div>
            <div class="sub-preview-list">
            <div v-for="(seg, i) in subSegments.slice(0, 20)" :key="i" class="sub-seg">
            <span class="sub-seg-time">{{ formatSubTime(seg.start) }} → {{ formatSubTime(seg.end) }}</span>
            <span class="sub-seg-text">{{ seg.text }}</span>
            </div>
            <div v-if="subSegments.length > 20" class="sub-seg sub-seg-more">
            ... +{{ subSegments.length - 20 }} more segments
            </div>
            </div>
            </div>

            <!-- Export SRT button -->
            <div v-if="subSegments.length" class="sub-row sub-srt-actions">
            <button class="sub-srt-btn sub-srt-export" @click="exportSrt">
            📝 Export SRT
            </button>
            <span v-if="subSrtPath" class="sub-path" :title="subSrtPath">✅ {{ subSrtPath.split('\\').pop() }}</span>
            </div>
          </div>

          <!-- TAB: Enhance -->
          <div v-show="activeTab === 'enhance'" class="ru-tab-panel">
            <div class="ruf-sub-heading">🛡️ Chống phát hiện Pixel</div>

            <label class="ruf-check">
              <input type="checkbox" :checked="pixelEnlarge > 0" @change="pixelEnlarge = ($event.target as HTMLInputElement).checked ? 50 : 0" /> 🟦 Phóng to Pixel
            </label>
            <div v-if="pixelEnlarge > 0" class="ruf-slider-row" style="padding-left:22px;">
              <input type="range" min="5" max="100" step="5" v-model.number="pixelEnlarge" class="ruf-slider" />
              <span class="ruf-val">{{ pixelEnlarge }}%</span>
            </div>
            <div v-else class="ruf-desc">&#8594; Ph&#243;ng to pixel, film-like bloom</div>

            <label class="ruf-check">
              <input type="checkbox" :checked="chromaShuffle > 0" @change="chromaShuffle = ($event.target as HTMLInputElement).checked ? 50 : 0" /> 🎨 Xáo trộn màu
            </label>
            <div v-if="chromaShuffle > 0" class="ruf-slider-row" style="padding-left:22px;">
              <input type="range" min="5" max="100" step="5" v-model.number="chromaShuffle" class="ruf-slider" />
              <span class="ruf-val">{{ chromaShuffle }}%</span>
            </div>
            <div v-else class="ruf-desc">&#8594; Hue rotation + saturation boost (max 30&#176;)</div>

            <label class="ruf-check">
              <input type="checkbox" v-model="rgbDrift" /> 🌈 Lệch kênh RGB
            </label>
            <div class="ruf-desc">&#8594; D&#7883;ch k&#234;nh RGB &#177;2px, anti-detect m&#7841;nh</div>

            <div style="height:1px; background:var(--border-default); margin:10px 0;"></div>
            <div class="ruf-sub-heading">🔒 Chống phát hiện nâng cao</div>

            <label class="ruf-check">
              <input type="checkbox" :checked="frameJitter > 0" @change="frameJitter = ($event.target as HTMLInputElement).checked ? 30 : 0" /> 📐 Rung khung hình
            </label>
            <div v-if="frameJitter > 0" class="ruf-slider-row" style="padding-left:22px;">
              <input type="range" min="5" max="100" step="5" v-model.number="frameJitter" class="ruf-slider" />
              <span class="ruf-val">{{ frameJitter }}%</span>
            </div>
            <div v-else class="ruf-desc">&#8594; Random &#177;1-5px shift per frame</div>

            <label class="ruf-check">
              <input type="checkbox" :checked="gammaShift > 0" @change="gammaShift = ($event.target as HTMLInputElement).checked ? 50 : 0" /> 🔆 Dịch Gamma
            </label>
            <div v-if="gammaShift > 0" class="ruf-slider-row" style="padding-left:22px;">
              <input type="range" min="5" max="100" step="5" v-model.number="gammaShift" class="ruf-slider" />
              <span class="ruf-val">{{ gammaShift }}%</span>
            </div>
            <div v-else class="ruf-desc">&#8594; Gamma curve oscillation per frame</div>

            <label class="ruf-check">
              <input type="checkbox" :checked="microColorCycle > 0" @change="microColorCycle = ($event.target as HTMLInputElement).checked ? 50 : 0" /> 🎨 Vi chỉnh màu
            </label>
            <div v-if="microColorCycle > 0" class="ruf-slider-row" style="padding-left:22px;">
              <input type="range" min="5" max="100" step="5" v-model.number="microColorCycle" class="ruf-slider" />
              <span class="ruf-val">{{ microColorCycle }}%</span>
            </div>
            <div v-else class="ruf-desc">&#8594; UV shift per frame, color fingerprint break</div>

            <label class="ruf-check">
              <input type="checkbox" :checked="dctNoise > 0" @change="dctNoise = ($event.target as HTMLInputElement).checked ? 50 : 0" /> 🧩 Nhiễu DCT
            </label>
            <div v-if="dctNoise > 0" class="ruf-slider-row" style="padding-left:22px;">
              <input type="range" min="5" max="100" step="5" v-model.number="dctNoise" class="ruf-slider" />
              <span class="ruf-val">{{ dctNoise }}%</span>
            </div>
            <div v-else class="ruf-desc">&#8594; 8x8 block noise, encoding fingerprint break</div>

            <div style="height:1px; background:var(--border-default); margin:10px 0;"></div>
            <div class="ruf-sub-heading">✨ Nâng cao</div>
            <label class="ruf-check" @click.prevent="pickLogo">
            <Image :size="12" /> 🖼️ Logo chìm
            </label>
            <div v-if="logoPath" class="ruf-logo-info">
            <span>{{ logoPath.split('\\').pop() }}</span>
            <button @click="clearLogo" class="ruf-clear">✕</button>
            </div>
            <div v-if="logoPath" class="ruf-slider-row">
            <span style="font-size:11px;">Vị trí</span>
            <button 
            class="ruf-auto-btn" 
            :class="{ active: logoPosition === 'auto' }"
            @click="logoPosition = logoPosition === 'auto' ? 'bottom-left' : 'auto'"
            >🔄 AUTO</button>
            <select v-model="logoPosition" class="ruf-select" :disabled="logoPosition === 'auto'" :style="logoPosition === 'auto' ? { opacity: 0.4 } : {}">
            <option v-for="p in LOGO_POSITIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
            </div>
            <div v-if="logoPath" class="ruf-slider-row">
            <span style="font-size:11px;">Kích thước</span>
            <input type="range" min="5" max="80" step="1" v-model.number="logoSize" class="ruf-slider" />
            <span class="ruf-val">{{ logoSize }}%</span>
            </div>

            <!-- Overlay Video -->
            <label class="ruf-check" @click.prevent="pickOverlay">
            📝 Video phủ
            </label>
            <div v-if="overlayPath" class="ruf-logo-info">
            <span>🎬 {{ overlayPath.split('\\').pop() }}</span>
            <button @click="clearOverlay" class="ruf-clear">✕</button>
            </div>
            <div v-if="overlayPath" class="ruf-slider-row">
            <span style="font-size:11px;">Độ mờ</span>
            <input type="range" min="0" max="100" step="5" v-model.number="overlayOpacity" class="ruf-slider" />
            <span class="ruf-val">{{ overlayOpacity }}%</span>
            </div>
            <div v-if="overlayPath" class="ruf-slider-row">
            <span style="font-size:11px;">Nhấp nháy</span>
            <button 
            class="ruf-auto-btn" 
            :class="{ active: overlayBlink }"
            @click="overlayBlink = !overlayBlink"
            >⚡ AUTO</button>
            <select v-if="overlayBlink" v-model.number="overlayBlinkSpeed" class="ruf-select" style="max-width:80px;">
            <option :value="0.10">0.10s ⚡</option>
            <option :value="0.25">0.25s</option>
            <option :value="0.5">0.5s</option>
            <option :value="1.0">1.0s</option>
            <option :value="1.5">1.5s</option>
            </select>
            </div>
            <div v-if="overlayPath && overlayBlink" class="ruf-slider-row">
            <span style="font-size:11px;">Khoảng cách</span>
            <button 
            class="ruf-auto-btn" 
            :class="{ active: overlayIntervalEnabled }"
            @click="overlayIntervalEnabled = !overlayIntervalEnabled"
            style="font-size:10px; padding:2px 6px;"
            >{{ overlayIntervalEnabled ? '⏱ ON' : '⏱ OFF' }}</button>
            <select v-if="overlayIntervalEnabled" v-model.number="overlayInterval" class="ruf-select" style="max-width:80px;" title="Flash every N seconds">
            <option :value="3">⏱ 3s</option>
            <option :value="5">⏱ 5s</option>
            <option :value="8">⏱ 8s</option>
            <option :value="11">⏱ 11s</option>
            <option :value="15">⏱ 15s</option>
            </select>
            </div>
            <div v-if="overlayPath" class="ruf-desc">
            → {{ overlayFiles.length }} overlay sẽ tự khớp N video input theo thứ tự, tốc độ tự điều chỉnh
            </div>

            <label class="ruf-check">
            <input type="checkbox" v-model="bgBlur" /> 🌫️ Background mờ
            </label>
            <div v-if="bgBlur" class="ruf-slider-row">
            <span style="font-size:11px;">Độ mờ</span>
            <input type="range" min="5" max="80" step="5" v-model.number="bgBlurAmount" class="ruf-slider" />
            <span class="ruf-val">{{ bgBlurAmount }}px</span>
            </div>
          </div>

          <!-- TAB: Interleave -->
          <div v-show="activeTab === 'interleave'" class="ru-tab-panel">
            <label class="ruf-check">
            <input type="checkbox" v-model="interleaveEnabled" />
            🔀 Xen kẽ khung hình (A/B)
            </label>
            <div v-if="interleaveEnabled" class="ruf-desc">
            Xen kẽ frame với video B → thay đổi fingerprint
            </div>
            <div v-if="interleaveEnabled" style="margin-top:6px;">
            <button class="ruf-auto-btn" @click="pickInterleaveFolder" style="width:100%;">
            🎬 {{ interleaveFolderPath ? interleaveFolderPath.split('\\').pop() : 'Chọn Video B' }}
            </button>
            <div v-if="interleaveFolderPath" style="margin-top:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:11px; color: var(--text-muted);">Khởi động</span>
            <select v-model.number="interleaveWarmup" class="ruf-select" style="max-width:80px;">
            <option :value="3">3 fr</option>
            <option :value="5">5 fr</option>
            <option :value="10">10 fr</option>
            <option :value="30">30 fr</option>
            </select>
            <span style="font-size:11px; color: var(--text-muted);">Tỷ lệ</span>
            <select v-model.number="interleaveRatio" class="ruf-select" style="max-width:80px;">
            <option :value="3">1/3</option>
            <option :value="5">1/5 ⭐</option>
            <option :value="10">1/10</option>
            <option :value="15">1/15</option>
            </select>
            </div>
            </div>
          </div>
        </div>
      </main>

      <!-- RIGHT: Settings -->
      <aside class="ru-right">
        <div class="ru-right-header">
          <Settings2 :size="14" />
          <span>{{ toolbarItems.find(t => t.id === activeFeature)?.label }}</span>
          <button v-if="activeFeature === 'auto'" class="ru-header-cut-btn" :class="{ active: showSplit }" @click="showSplit = !showSplit">
            ✂️ Cắt
          </button>
        </div>

        <ReupPanel
          :key="reupPanelKey"
          v-if="activeFeature === 'auto' && !showSplit"
          :musicPath="musicPath" :applyHDR="applyHDR"
          :frameTemplate="frameTemplate"
          v-model:mirror="mirror" v-model:crop="crop"
          v-model:cropX="cropX" v-model:cropY="cropY"
          v-model:noise="noise" v-model:rotate="rotate"
          v-model:lensDistortion="lensDistortion"
          v-model:speed="speed" v-model:audioEvade="audioEvade"
          v-model:removeAudio="removeAudio"
          v-model:colorGrading="colorGrading"
          v-model:glow="glow" v-model:volumeBoost="volumeBoost"
          v-model:titleTemplate="titleTemplate"
          v-model:titleText="titleText"
          v-model:descText="descText"
          v-model:borderWidth="borderWidth"
          v-model:borderColor="borderColor"
          v-model:zoomEffect="zoomEffect"
          v-model:zoomIntensity="zoomIntensity"
          v-model:logoPath="logoPath"
          v-model:logoPosition="logoPosition"
          v-model:logoSize="logoSize"
          v-model:pixelEnlarge="pixelEnlarge"
          v-model:chromaShuffle="chromaShuffle"
          v-model:rgbDrift="rgbDrift"
          :frameJitter="frameJitter"
          :gammaShift="gammaShift"
          :microColorCycle="microColorCycle"
          :dctNoise="dctNoise"
          :splitEnabled="splitEnabled"
          :splitDuration="splitDuration"
          :splitInputPath="splitInputPath"
          :splitShowTitle="splitShowTitle"
          :splitShowPart="splitShowPart"
          :overlayPath="overlayPath"
          :overlayOpacity="overlayOpacity"
          :overlayFiles="overlayFiles"
          :bgBlur="bgBlur"
          :bgBlurAmount="bgBlurAmount"
          @applyPreset="applyPreset"
        />

        <SplitPanel v-if="activeFeature === 'auto' && showSplit" />

        <div v-if="activeFeature === 'music'" class="ru-music-panel">
          <div class="ru-music-section">
            <p class="ru-music-title">🎵 Nhạc nền</p>
            <p class="ru-music-desc">Trộn vào tất cả video reup với 25% âm lượng (lặp lại).</p>
            <button class="ru-music-pick" @click="pickMusic">
              <Music :size="14" />{{ musicFileName || 'Chọn file nhạc' }}
            </button>
            <button v-if="musicPath" class="ru-music-remove" @click="clearMusic">✕ Xóa nhạc</button>
            <div v-if="musicPath" class="ru-music-info">
              <span class="ru-music-badge">Đang dùng</span><span>{{ musicFileName }}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style src="../styles/reup.css" />
