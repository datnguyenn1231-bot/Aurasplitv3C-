<script setup lang="ts">
import { Shield, Upload, CheckCircle2 } from 'lucide-vue-next'
</script>

<template>
  <div class="view">
    <header class="view-head">
      <div class="head-top">
        <div class="head-icon"><Shield :size="20" /></div>
        <h1 class="head-title">Xóa Metadata</h1>
      </div>
      <p class="head-sub">Xóa dữ liệu AI nhận diện — bảo vệ nội dung của bạn</p>
    </header>

    <div class="drop-zone">
      <div class="drop-icon"><Upload :size="28" /></div>
      <p class="drop-title">Thả video vào đây để xóa metadata</p>
      <p class="drop-sub">FFmpeg loại bỏ metadata + tùy chọn mã hóa lại</p>
    </div>

    <!-- Features -->
    <div class="feature-list">
      <div class="feature" v-for="f in features" :key="f">
        <CheckCircle2 :size="14" />
        <span>{{ f }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
const features = [
  'Xóa tất cả EXIF & thẻ metadata',
  'Loại bỏ dấu hiệu AI tạo',
  'Tùy chọn mã hóa lại hoàn toàn',
  'Xử lý hàng loạt nhiều file',
]
</script>

<style scoped>
.view { max-width: 700px; position: relative; }

.view-head { margin-bottom: 28px; }
.head-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, var(--amber), hsl(25, 85%, 55%));
  display: flex; align-items: center; justify-content: center;
  color: white; box-shadow: 0 2px 16px hsla(38, 90%, 60%, 0.25);
}
.head-title { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
.head-sub { color: var(--text-secondary); font-size: 13px; padding-left: 48px; }

.drop-zone {
  background: var(--bg-card); border: 1px dashed var(--border-default);
  border-radius: 14px; padding: 48px; text-align: center;
  transition: all 0.3s ease; cursor: pointer; margin-bottom: 20px;
}
.drop-zone:hover { border-color: var(--amber); background: var(--bg-card-hover); }

.drop-icon {
  width: 56px; height: 56px; border-radius: 14px; margin: 0 auto 12px;
  background: hsla(38, 90%, 60%, 0.08); border: 1px solid hsla(38, 90%, 60%, 0.15);
  display: flex; align-items: center; justify-content: center; color: var(--amber);
}
.drop-title { font-size: 14px; font-weight: 500; color: var(--text-secondary); }
.drop-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

.feature-list { display: flex; flex-direction: column; gap: 8px; }
.feature {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 10px;
  background: var(--bg-card); border: 1px solid var(--border-subtle);
  font-size: 13px; color: var(--text-secondary);
}
.feature svg { color: var(--emerald); flex-shrink: 0; }
</style>
