<script setup lang="ts">
/**
 * ReupDropzone — Drag & drop / click to import video for preview.
 */
import { ref } from 'vue'
import { Upload } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'load-video', filePath: string): void
}>()

const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts']
const dropHover = ref(false)

function onDragOver(e: DragEvent) { e.preventDefault(); dropHover.value = true }
function onDragLeave() { dropHover.value = false }

function onDrop(e: DragEvent) {
  e.preventDefault()
  dropHover.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  const filePath = (files[0] as any).path
  if (!filePath) return
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (!VIDEO_EXTS.includes(ext)) return
  emit('load-video', filePath)
}

async function importFile() {
  const files = await window.electronAPI.selectFiles({
    title: 'Chọn video',
    filters: [{ name: 'Video', extensions: VIDEO_EXTS }],
  })
  if (files?.length) emit('load-video', files[0])
}
</script>

<template>
  <div
    class="ru-dropzone"
    :class="{ hover: dropHover }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @click="importFile"
  >
    <div class="dz-icon"><Upload :size="36" /></div>
    <p class="dz-title">Thả video để xem trước</p>
    <p class="dz-sub">Bật hiệu ứng bên phải → xem trực tiếp trên màn hình</p>
  </div>
</template>

<style scoped>
.ru-dropzone {
  width: 100%; max-width: 600px; aspect-ratio: 16 / 9;
  background: rgba(255,255,255,0.02);
  border: 2px dashed var(--border-default);
  border-radius: 14px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 10px; cursor: pointer; transition: all 0.3s;
}
.ru-dropzone:hover, .ru-dropzone.hover {
  border-color: #f97316;
  background: rgba(249, 115, 22, 0.04);
}
.ru-dropzone.hover .dz-icon { color: #f97316; transform: translateY(-4px) scale(1.1); }
.dz-icon { color: var(--text-muted); transition: all 0.3s; }
.ru-dropzone:hover .dz-icon { color: #f97316; }
.dz-title { font-size: 15px; font-weight: 600; color: var(--text-secondary); margin: 0; }
.dz-sub { font-size: 11px; color: var(--text-muted); margin: 0; }
</style>
