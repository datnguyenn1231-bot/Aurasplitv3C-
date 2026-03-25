<script setup lang="ts">
/**
 * VideoPreview â€” HTML5 video player with custom controls.
 * Handles play/pause, seeking, volume, frame stepping, fullscreen.
 * Emits time updates to parent composable.
 */
import { ref, watch, watchEffect, onMounted, onUnmounted } from 'vue'
import {
  Play, Pause, Volume2, VolumeX, Maximize,
  SkipBack, SkipForward
} from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  src: string
  isPlaying: boolean
  volume: number
  playbackRate?: number
  volumeBoost?: number
  cropClipPath?: string
}>(), {
  playbackRate: 1.0,
  volumeBoost: 1.0,
})


const emit = defineEmits<{
  'update:isPlaying': [value: boolean]
  'update:volume': [value: number]
  'timeupdate': [time: number]
  'durationchange': [duration: number]
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const progressRef = ref<HTMLDivElement | null>(null)
const currentTime = ref(0)
const duration = ref(0)
const isMuted = ref(false)
const isFullscreen = ref(false)
const showControls = ref(true)
const isReady = ref(false)
const isBuffering = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null



// â”€â”€ Format time â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmt(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// â”€â”€ Play / Pause â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** Called by native <video> @play event â€” most reliable hook */
function onVideoPlay() {
  const v = videoRef.value
  if (!v) return
  const target = props.playbackRate ?? 1.0

  v.playbackRate = target
  // Verify after next frame
  requestAnimationFrame(() => {
    if (v) {

      if (v.playbackRate !== target) {
        v.playbackRate = target

      }
    }
  })
}

function enforcePlayback() {
  const v = videoRef.value
  if (!v) return
  const rate = props.playbackRate ?? 1.0
  if (v.playbackRate !== rate) {
    v.playbackRate = rate

  }
  // Volume boost via GainNode
  const boost = props.volumeBoost ?? 1.0
  if (boost !== 1.0) {
    ensureGainNode()
    if (gainNode) gainNode.gain.value = boost

  }
}

function togglePlay() {
  const v = videoRef.value
  if (!v) return
  if (v.paused) {
    if (v.readyState >= 3) {
      v.play()
      enforcePlayback()
    } else {
      v.addEventListener('canplay', () => { v.play(); enforcePlayback() }, { once: true })
      v.load()
    }
    emit('update:isPlaying', true)
  } else {
    v.pause()
    emit('update:isPlaying', false)
  }
}

// â”€â”€ Seek via click + drag on progress bar â”€â”€â”€
const isSeeking = ref(false)
let wasPlayingBeforeSeek = false

function seekFromEvent(e: MouseEvent) {
  const bar = progressRef.value
  const v = videoRef.value
  if (!bar || !v || !duration.value) return
  const rect = bar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const t = pct * duration.value
  v.currentTime = t
  currentTime.value = t
  emit('timeupdate', t)
}

function onSeekStart(e: MouseEvent) {
  const v = videoRef.value
  if (!v) return
  isSeeking.value = true
  wasPlayingBeforeSeek = !v.paused
  if (wasPlayingBeforeSeek) v.pause()
  seekFromEvent(e)
  document.addEventListener('mousemove', onSeekMove)
  document.addEventListener('mouseup', onSeekEnd)
}

function onSeekMove(e: MouseEvent) {
  if (!isSeeking.value) return
  seekFromEvent(e)
}

function onSeekEnd() {
  isSeeking.value = false
  document.removeEventListener('mousemove', onSeekMove)
  document.removeEventListener('mouseup', onSeekEnd)
  if (videoRef.value && wasPlayingBeforeSeek) {
    videoRef.value.play()
    emit('update:isPlaying', true)
  }
}

// â”€â”€ Frame step (Â±1 frame @ 30fps â‰ˆ Â±0.033s)
function stepFrame(dir: number) {
  const v = videoRef.value
  if (!v) return
  v.pause()
  emit('update:isPlaying', false)
  const t = Math.max(0, Math.min(duration.value, v.currentTime + dir * (1 / 30)))
  v.currentTime = t
  currentTime.value = t
  emit('timeupdate', t)
}

// â”€â”€ Volume â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toggleMute() {
  const v = videoRef.value
  if (!v) return
  isMuted.value = !isMuted.value
  v.muted = isMuted.value
}

function setVolume(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  emit('update:volume', val)
  if (videoRef.value) videoRef.value.volume = val
  isMuted.value = val === 0
}

// â”€â”€ Fullscreen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toggleFullscreen() {
  const container = videoRef.value?.parentElement?.parentElement
  if (!container) return
  if (document.fullscreenElement) {
    document.exitFullscreen()
    isFullscreen.value = false
  } else {
    container.requestFullscreen()
    isFullscreen.value = true
  }
}

// â”€â”€ Auto-hide controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function onMouseMove() {
  showControls.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (props.isPlaying) showControls.value = false
  }, 2500)
}

// â”€â”€ Video events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function onTimeUpdate() {
  if (!videoRef.value || isSeeking.value) return
  currentTime.value = videoRef.value.currentTime
  emit('timeupdate', currentTime.value)
}

function onDurationChange() {
  if (!videoRef.value) return
  duration.value = videoRef.value.duration
  emit('durationchange', duration.value)
}

function onEnded() {
  emit('update:isPlaying', false)
}

function onCanPlay() {
  isReady.value = true
  isBuffering.value = false
  enforcePlayback()
}

/** Web Audio GainNode for volume boost beyond 1.0 */
let audioCtx: AudioContext | null = null
let gainNode: GainNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null
let gainInitialized = false

function ensureGainNode() {
  const v = videoRef.value
  if (!v || gainInitialized) return
  try {
    audioCtx = new AudioContext()
    sourceNode = audioCtx.createMediaElementSource(v)
    gainNode = audioCtx.createGain()
    sourceNode.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    gainInitialized = true
  } catch (e) {
  }
}

function onWaiting() {
  isBuffering.value = true
}

function onPlaying() {
  isBuffering.value = false
  enforcePlayback()
}

function onSeeked() {
  isBuffering.value = false
}

// â”€â”€ Handle src change (remux swap) â€” preserve position â”€â”€
watch(() => props.src, (newSrc) => {
  if (!newSrc || !videoRef.value) return
  const v = videoRef.value
  const savedTime = v.currentTime || 0
  const wasPlaying = !v.paused
  if (wasPlaying) v.pause()

  v.load()
  v.addEventListener('loadedmetadata', () => {
    // Re-apply speed after load reset
    v.playbackRate = props.playbackRate ?? 1.0
    if (savedTime > 0 && savedTime < v.duration) {
      v.currentTime = savedTime
    }
    if (wasPlaying) {
      v.addEventListener('canplay', () => v.play(), { once: true })
    }
  }, { once: true })
})

// â”€â”€ Keyboard shortcuts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function onKeyDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) return
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      e.preventDefault()
      stepFrame(-1)
      break
    case 'ArrowRight':
      e.preventDefault()
      stepFrame(1)
      break
    case 'KeyM':
      toggleMute()
      break
  }
}

// â”€â”€ Sync volume prop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
watch(() => props.volume, (v) => {
  if (videoRef.value) videoRef.value.volume = Math.min(1, Math.max(0, v))
})

// â”€â”€ Sync playbackRate â€” watchEffect guarantees it runs after mount â”€â”€
watchEffect(() => {
  const v = videoRef.value
  const rate = props.playbackRate
  if (v && rate && v.playbackRate !== rate) {
    v.playbackRate = rate
  }
}, { flush: 'post' })

// â”€â”€ Sync volumeBoost â€” lazy GainNode init on first boost â”€â”€
watchEffect(() => {
  const boost = props.volumeBoost ?? 1.0
  if (boost > 1.0) {
    ensureGainNode()
  }
  if (gainNode) {
    gainNode.gain.value = boost
  }
}, { flush: 'post' })

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('mousemove', onSeekMove)
  document.removeEventListener('mouseup', onSeekEnd)
  if (hideTimer) clearTimeout(hideTimer)
  // Cleanup Web Audio
  if (audioCtx) { audioCtx.close(); audioCtx = null }
  gainNode = null; sourceNode = null; gainInitialized = false
})

// Expose videoRef so parent can directly control playback
defineExpose({ videoRef })
</script>

<template>
  <div class="vp-container" @mousemove="onMouseMove">
    <video
      ref="videoRef"
      :src="src"
      class="vp-video"
      preload="auto"
      @play="onVideoPlay"
      @canplay="onCanPlay"
      @waiting="onWaiting"
      @playing="onPlaying"
      @seeked="onSeeked"
      @timeupdate="onTimeUpdate"
      @durationchange="onDurationChange"
      @ended="onEnded"
      @click="togglePlay"
      @dblclick="toggleFullscreen"
      :style="props.cropClipPath ? { clipPath: props.cropClipPath } : undefined"
    />


    <!-- Loading spinner during seek/buffer -->
    <div v-if="isBuffering" class="vp-spinner-overlay">
      <div class="vp-spinner" />
    </div>

    <!-- Controls overlay -->
    <div class="vp-controls" :class="{ hidden: !showControls }">
      <!-- Progress bar -->
      <div ref="progressRef" class="vp-progress" @mousedown="onSeekStart">
        <div class="vp-progress-fill" :style="{ width: duration ? (currentTime / duration * 100) + '%' : '0%' }" />
        <div class="vp-progress-thumb" :style="{ left: duration ? (currentTime / duration * 100) + '%' : '0%' }" />
      </div>

      <div class="vp-bar">
        <!-- Left: Play + Frame step + Time -->
        <div class="vp-left">
          <button class="vp-btn" @click="togglePlay" :title="props.isPlaying ? 'Pause' : 'Play'">
            <Pause v-if="props.isPlaying" :size="18" />
            <Play v-else :size="18" fill="currentColor" />
          </button>
          <button class="vp-btn" @click="stepFrame(-1)" title="Previous frame (â†)">
            <SkipBack :size="14" />
          </button>
          <button class="vp-btn" @click="stepFrame(1)" title="Next frame (â†’)">
            <SkipForward :size="14" />
          </button>
          <span class="vp-time">{{ fmt(currentTime) }} / {{ fmt(duration) }}</span>
        </div>

        <!-- Right: Volume + Fullscreen -->
        <div class="vp-right">
          <button class="vp-btn" @click="toggleMute">
            <VolumeX v-if="isMuted" :size="16" />
            <Volume2 v-else :size="16" />
          </button>
          <input
            type="range" min="0" max="1" step="0.05"
            :value="props.volume" @input="setVolume"
            class="vp-vol-slider"
          />
          <button class="vp-btn" @click="toggleFullscreen" title="Fullscreen">
            <Maximize :size="15" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vp-container {
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  max-height: 360px;
  cursor: pointer;
}

.vp-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

/* â”€â”€ Controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
.vp-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
  padding: 24px 12px 10px;
  transition: opacity 0.3s ease;
}
.vp-controls.hidden { opacity: 0; pointer-events: none; }

.vp-progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  margin-bottom: 8px;
  cursor: pointer;
  position: relative;
}
.vp-progress:hover { height: 6px; margin-bottom: 6px; }

.vp-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.05s linear;
}

.vp-progress-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity 0.2s;
}
.vp-progress:hover .vp-progress-thumb { opacity: 1; }

.vp-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vp-left, .vp-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.vp-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}
.vp-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.vp-time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}

.vp-vol-slider {
  width: 70px;
  height: 3px;
  accent-color: var(--accent);
  cursor: pointer;
}

/* â”€â”€ Loading spinner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
.vp-spinner-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  pointer-events: none;
  z-index: 5;
}

.vp-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent, #a78bfa);
  border-radius: 50%;
  animation: vp-spin 0.8s linear infinite;
}

@keyframes vp-spin {
  to { transform: rotate(360deg); }
}


</style>

<!--
  Non-scoped overrides: allows parent .ru-frame-wrapper ratio classes
  to change the container aspect-ratio and video object-fit.
-->
<style>
/* When inside a ratio wrapper, override container ratio */
.ru-frame-wrapper[class*="ratio-"] .vp-container {
    aspect-ratio: auto !important;
    max-height: none !important;
    border-radius: 0 !important;
    width: 100% !important;
    height: 100% !important;
    background: transparent !important;
}

.ru-frame-wrapper[class*="ratio-"] .vp-video {
    object-fit: contain !important;
}

.bg-blur-active .vp-container {
    background: transparent !important;
}
.bg-blur-active .vp-video {
    background: transparent !important;
}
</style>

