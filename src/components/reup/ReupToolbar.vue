<script setup lang="ts">
/**
 * ReupToolbar — Left sidebar toolbar for Reup view features.
 */
import { Music } from 'lucide-vue-next'

type ReupFeature = 'auto' | 'music'

defineProps<{
  activeFeature: ReupFeature
  toolbarItems: { id: ReupFeature; label: string; icon: any }[]
  musicFileName: string
}>()

const emit = defineEmits<{
  (e: 'update:activeFeature', v: ReupFeature): void
  (e: 'clear-music'): void
}>()
</script>

<template>
  <aside class="ru-left">
    <button
      v-for="item in toolbarItems"
      :key="item.id"
      class="ru-tool-btn"
      :class="{ active: activeFeature === item.id }"
      @click="emit('update:activeFeature', item.id)"
    >
      <component :is="item.icon" :size="16" />
      <span>{{ item.label }}</span>
    </button>

    <!-- Music indicator -->
    <div v-if="musicFileName" class="ru-music-indicator" @click="emit('update:activeFeature', 'music')">
      <Music :size="12" />
      <span class="ru-music-name">{{ musicFileName }}</span>
      <button class="ru-music-clear" @click.stop="emit('clear-music')">✕</button>
    </div>
  </aside>
</template>

<style scoped>
.ru-left {
  width: 130px; flex-shrink: 0;
  background: var(--bg-card);
  border-right: 1px solid var(--border-default);
  display: flex; flex-direction: column;
  padding: 8px 6px; gap: 2px; overflow-y: auto;
}
.ru-tool-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border: none; border-radius: 6px;
  background: none; color: var(--text-muted);
  font-size: 12px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  text-align: left; white-space: nowrap;
}
.ru-tool-btn:hover { background: var(--bg-card-hover); color: var(--text-primary); }
.ru-tool-btn.active { background: hsla(25, 80%, 50%, 0.12); color: #f97316; font-weight: 600; }

.ru-music-indicator {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; margin: 2px 6px; border-radius: 6px;
  background: hsla(280, 60%, 50%, 0.15);
  border: 1px solid hsla(280, 60%, 50%, 0.25);
  cursor: pointer; transition: background 0.15s;
  font-size: 10px; color: hsla(280, 80%, 75%, 1);
}
.ru-music-indicator:hover { background: hsla(280, 60%, 50%, 0.25); }
.ru-music-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80px; }
.ru-music-clear {
  background: none; border: none; color: hsla(280, 60%, 70%, 0.7);
  cursor: pointer; font-size: 10px; padding: 0 2px; line-height: 1;
}
.ru-music-clear:hover { color: #ff6b6b; }
</style>
