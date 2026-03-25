<script setup lang="ts">
/**
 * MediaInfo — Compact metadata bar for loaded video.
 * Shows resolution, duration, codec, fps, bitrate, file size.
 */
import { computed } from 'vue'
import type { VideoMetadata } from '../../composables/useEditor'
import { Monitor, Clock, Film, Gauge, HardDrive } from 'lucide-vue-next'

const props = defineProps<{
  meta: VideoMetadata
}>()

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatBitrate(bps: number): string {
  if (bps === 0) return '—'
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(0)} kbps`
  return `${(bps / 1_000_000).toFixed(1)} Mbps`
}

const items = computed(() => [
  { icon: Monitor, label: `${props.meta.width}×${props.meta.height}`, title: 'Độ phân giải' },
  { icon: Clock, label: formatDuration(props.meta.duration), title: 'Thời lượng' },
  { icon: Film, label: props.meta.codec.toUpperCase(), title: 'Codec' },
  { icon: Gauge, label: `${props.meta.fps} fps`, title: 'Tốc độ khung hình' },
  { icon: HardDrive, label: `${formatSize(props.meta.fileSize)} · ${formatBitrate(props.meta.bitrate)}`, title: 'Dung lượng & Bitrate' },
])
</script>

<template>
  <div class="mi-bar">
    <div v-for="item in items" :key="item.title" class="mi-item" :title="item.title">
      <component :is="item.icon" :size="13" />
      <span>{{ item.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.mi-bar {
  display: flex;
  gap: 16px;
  padding: 10px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.mi-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.mi-item svg { color: var(--text-muted); }
</style>
