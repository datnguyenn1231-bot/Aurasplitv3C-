<script setup lang="ts">
/**
 * EditorView — Video Editor main view.
 * 3-column layout: Left Toolbar | Center Preview | Right Settings
 * Bottom: Timeline placeholder (Phase 3)
 */
import { ref, computed } from 'vue'
import {
  Film, Upload, Loader2, X,
  Music, Merge, Settings2, Sun
} from 'lucide-vue-next'
import { useEditor } from '../composables/useEditor'
import VideoPreview from '../components/editor/VideoPreview.vue'
import MediaInfo from '../components/editor/MediaInfo.vue'
import MergePanel from '../components/editor/MergePanel.vue'

const {
  videoUrl, metadata, hasVideo, isLoading, error, isPlaying, volume,
  loadVideo, closeVideo,
} = useEditor()

// ── Active feature in left toolbar ──────────
type EditorFeature = 'video' | 'effects' | 'text' | 'image' | 'background' | 'music' | 'merge'
const activeFeature = ref<EditorFeature>('merge')

const toolbarItems: { id: EditorFeature; label: string; icon: any }[] = [
  { id: 'merge',      label: 'Ghép video',    icon: Merge },
  { id: 'music',      label: 'Nhạc nền',      icon: Music },
]

// ── Shared Music State (global for all features) ──
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

function clearMusic() {
  musicPath.value = ''
}

// ── Shared HDR State (global for all features) ──
const applyHDR = ref(false)

async function importVideoFile() {
  const files = await window.electronAPI.selectFiles({
    title: 'Chọn video',
    filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts'] }],
  })
  if (files?.length) await loadVideo(files[0])
}

// ── Drag & Drop ─────────────────────────────
const dropHover = ref(false)

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dropHover.value = true
}

function onDragLeave() {
  dropHover.value = false
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  dropHover.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  const filePath = (files[0] as any).path
  if (!filePath) return

  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts']
  if (!videoExts.includes(ext)) return

  await loadVideo(filePath)
}

function onTimeUpdate(_t: number) {
  // Will be used by timeline later
}

function onDurationChange(_d: number) {
  // Will be used by timeline later
}

async function onMergeComplete(finalPath: string) {
  if (finalPath) await loadVideo(finalPath)
}
</script>

<template>
  <div class="editor-layout">
    <!-- ═══ Top Bar ═══ -->
    <header class="ed-topbar">
      <div class="ed-topbar-left">
        <div class="ed-logo"><Film :size="16" /></div>
        <span class="ed-title">Biên tập Video</span>

        <!-- Music Path Selector (compact) -->
        <div class="tb-path-item" @click="pickMusic">
          <Music :size="12" />
          <span class="tb-path-label">Nhạc</span>
          <span class="tb-path-value" :class="{ empty: !musicPath }">
            {{ musicFileName || 'Không có' }}
          </span>
        </div>
        <button v-if="musicPath" class="tb-path-clear" @click.stop="clearMusic" title="Xóa nhạc">✕</button>

        <!-- HDR Toggle (compact) -->
        <div class="tb-hdr-toggle" :class="{ active: applyHDR }" @click="applyHDR = !applyHDR">
          <Sun :size="12" />
          <span>HDR</span>
        </div>
      </div>
      <div class="ed-topbar-right">
        <span v-if="metadata" class="ed-meta-badge">
          {{ metadata.width }}×{{ metadata.height }}
        </span>
      </div>
    </header>

    <!-- ═══ Main 3-Column Layout ═══ -->
    <div class="ed-main">
      <!-- LEFT: Toolbar -->
      <aside class="ed-left">
        <button
          v-for="item in toolbarItems"
          :key="item.id"
          class="ed-tool-btn"
          :class="{ active: activeFeature === item.id }"
          @click="activeFeature = item.id"
        >
          <component :is="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </button>

        <!-- Music indicator (always visible when music loaded) -->
        <div v-if="musicPath" class="ed-music-indicator" @click="activeFeature = 'music'">
          <Music :size="12" />
          <span class="ed-music-name">{{ musicFileName }}</span>
          <button class="ed-music-clear" @click.stop="clearMusic" title="Xóa nhạc">✕</button>
        </div>

        <!-- Settings section at bottom -->
        <div class="ed-left-spacer" />
        <div class="ed-left-settings">
          <div class="ed-left-divider" />
          <MediaInfo v-if="metadata" :meta="metadata" />
        </div>
      </aside>

      <!-- CENTER: Preview (always visible) -->
      <main class="ed-center">
        <!-- Loading -->
        <div v-if="isLoading" class="ed-loading">
          <Loader2 :size="24" class="spin" />
          <span>Đang tải video...</span>
        </div>

        <!-- Error -->
        <div v-if="error" class="ed-error">{{ error }}</div>

        <!-- Drop Zone (no video) -->
        <div
          v-if="!hasVideo && !isLoading"
          class="ed-dropzone"
          :class="{ hover: dropHover }"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
          @click="importVideoFile"
        >
          <div class="dz-icon"><Upload :size="36" /></div>
          <p class="dz-title">Thả video vào đây</p>
          <p class="dz-sub">hoặc nhấn để nhập (MP4, MKV, AVI, MOV, WebM)</p>
        </div>

        <!-- Video Preview -->
        <div
          v-if="hasVideo"
          class="ed-preview"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <VideoPreview
            :src="videoUrl!"
            :isPlaying="isPlaying"
            :volume="volume"
            @update:isPlaying="isPlaying = $event"
            @update:volume="volume = $event"
            @timeupdate="onTimeUpdate"
            @durationchange="onDurationChange"
          />
          <!-- Cancel Video Button -->
          <button class="ed-cancel-video" @click="closeVideo" title="Đóng video">
            <X :size="14" />
          </button>
        </div>
      </main>

      <!-- RIGHT: Settings Panel (dynamic) -->
      <aside class="ed-right">
        <div class="ed-right-header">
          <Settings2 :size="14" />
          <span>{{ toolbarItems.find(t => t.id === activeFeature)?.label }}</span>
        </div>

        <!-- Merge settings -->
        <MergePanel v-if="activeFeature === 'merge'" :musicPath="musicPath" :applyHDR="applyHDR" @update:musicPath="musicPath = $event" @mergeComplete="onMergeComplete" />

        <!-- Music settings -->
        <div v-else-if="activeFeature === 'music'" class="ed-music-panel">
          <div class="ed-music-section">
            <p class="ed-music-title">🎵 Nhạc nền</p>
            <p class="ed-music-desc">Nhạc này sẽ được dùng cho tất cả tính năng (Ghép, Hiệu ứng...)</p>

            <button class="ed-music-pick" @click="pickMusic">
              <Music :size="14" />
              {{ musicFileName || 'Chọn file nhạc' }}
            </button>

            <button v-if="musicPath" class="ed-music-remove" @click="clearMusic">
              ✕ Xóa nhạc
            </button>

            <div v-if="musicPath" class="ed-music-info">
              <span class="ed-music-badge">Đang dùng</span>
              <span>{{ musicFileName }}</span>
            </div>
          </div>
        </div>

        <!-- Placeholder for other features -->
        <div v-else class="ed-right-placeholder">
          <p>{{ toolbarItems.find(t => t.id === activeFeature)?.label }}</p>
          <p class="ed-right-soon">Sắp ra mắt</p>
        </div>
      </aside>
    </div>

    <!-- ═══ Bottom Timeline ═══ -->
    <div class="ed-timeline">
      <div class="tl-row">
        <span class="tl-label-track">Text</span>
        <div class="tl-track" />
      </div>
      <div class="tl-row">
        <span class="tl-label-track">Video</span>
        <div class="tl-track accent" />
      </div>
      <div class="tl-row">
        <span class="tl-label-track">Music</span>
        <div class="tl-track warm" />
      </div>
    </div>
  </div>
</template>

<style src="../styles/editor.css" scoped></style>

