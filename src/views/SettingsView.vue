<script setup lang="ts">
import { Settings, Monitor, Palette, Info } from 'lucide-vue-next'
</script>

<template>
  <div class="view">
    <header class="view-head">
      <div class="head-top">
        <div class="head-icon"><Settings :size="20" /></div>
        <h1 class="head-title">Cài đặt</h1>
      </div>
      <p class="head-sub">Cấu hình ứng dụng & thông tin hệ thống</p>
    </header>

    <!-- Sections -->
    <div class="section">
      <h3 class="section-title">
        <Palette :size="14" />
        <span>Giao diện</span>
      </h3>
      <div class="row">
        <span class="row-label">Chủ đề</span>
        <span class="row-value">
          <span class="theme-dot dark" />
          Tối
        </span>
      </div>
      <div class="row">
        <span class="row-label">Ngôn ngữ</span>
        <span class="row-value">Tiếng Việt</span>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title">
        <Monitor :size="14" />
        <span>Hiệu suất</span>
      </h3>
      <div class="row">
        <span class="row-label">Đường dẫn FFmpeg</span>
        <span class="row-value mono">binaries/ffmpeg.exe</span>
      </div>
      <div class="row">
        <span class="row-label">Python nhúng</span>
        <span class="row-value mono">python_embed/python.exe</span>
      </div>
    </div>

    <div class="section">
      <h3 class="section-title">
        <Info :size="14" />
        <span>Thông tin</span>
      </h3>
      <div class="row">
        <span class="row-label">Phiên bản</span>
        <span class="row-value badge">2.0.0-alpha</span>
      </div>
      <div class="row">
        <span class="row-label">Nền tảng</span>
        <span class="row-value">Electron + Vue 3</span>
      </div>
      <div class="row">
        <span class="row-label">Bản quyền</span>
        <span class="row-value">Chưa kích hoạt</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { max-width: 600px; position: relative; }

.view-head { margin-bottom: 28px; }
.head-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, hsl(220, 15%, 40%), hsl(220, 15%, 30%));
  display: flex; align-items: center; justify-content: center;
  color: white;
}
.head-title { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
.head-sub { color: var(--text-secondary); font-size: 13px; padding-left: 48px; }

.section {
  background: var(--bg-card); border: 1px solid var(--border-default);
  border-radius: 14px; padding: 16px 18px; margin-bottom: 12px;
}

.section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 12px;
}

.row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--border-subtle);
}
.row:last-child { border-bottom: none; }

.row-label { font-size: 13px; color: var(--text-secondary); }
.row-value {
  font-size: 13px; color: var(--text-primary);
  display: flex; align-items: center; gap: 6px;
}
.row-value.mono {
  font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
  font-size: 12px; color: var(--text-muted);
}

.badge {
  background: var(--accent-glow); color: var(--accent);
  padding: 2px 8px; border-radius: 5px;
  font-size: 12px; font-weight: 600;
}

.theme-dot {
  width: 8px; height: 8px; border-radius: 50%;
}
.theme-dot.dark { background: var(--bg-base); border: 1px solid var(--border-hover); }
</style>
