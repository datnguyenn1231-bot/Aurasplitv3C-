<script setup lang="ts">
import { useRoute } from 'vue-router'
import {
  Scissors, Film, Shield, Settings,
  Zap, Repeat, ImageDown
} from 'lucide-vue-next'

const route = useRoute()

const navItems = [
  { path: '/ai-cut', label: 'Đồng bộ', icon: Scissors, color: 'var(--cyan)' },
  { path: '/editor', label: 'Biên tập', icon: Film, color: 'var(--accent)' },
  { path: '/reup', label: 'Reup', icon: Repeat, color: 'var(--orange, #f97316)' },
  { path: '/v2img', label: 'Cắt ảnh', icon: ImageDown, color: '#f97316' },
  { path: '/metadata', label: 'Metadata', icon: Shield, color: 'var(--amber)' },
  { path: '/settings', label: 'Cài đặt', icon: Settings, color: 'var(--text-secondary)' },
]

const isActive = (path: string) => route.path === path
</script>

<template>
  <aside class="sidebar">
    <!-- Brand -->
    <div class="brand">
      <div class="brand-icon">
        <Zap :size="18" stroke-width="2.5" />
      </div>
      <span class="brand-name">AuraSplit</span>
      <span class="brand-tag">v2</span>
    </div>

    <!-- Divider -->
    <div class="divider" />

    <!-- Nav -->
    <nav class="nav">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-link"
        :class="{ active: isActive(item.path) }"
        :style="isActive(item.path) ? { '--item-color': item.color } : {}"
      >
        <div class="nav-icon-wrap" :class="{ active: isActive(item.path) }">
          <component :is="item.icon" :size="18" stroke-width="1.8" />
        </div>
        <span class="nav-label">{{ item.label }}</span>
        <div v-if="isActive(item.path)" class="active-indicator" />
      </router-link>
    </nav>

    <!-- Bottom -->
    <div class="sidebar-bottom">
      <div class="divider" />
      <div class="status-row">
        <div class="status-pulse" />
        <span class="status-label">Sẵn sàng</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: calc(100vh - var(--titlebar-height));
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  user-select: none;
  position: relative;
  z-index: 10;
}

/* Subtle gradient sheen on sidebar */
.sidebar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 120px;
  background: linear-gradient(
    180deg,
    hsla(var(--accent-h), 40%, 30%, 0.05) 0%,
    transparent 100%
  );
  pointer-events: none;
}

.brand {
  padding: 20px 18px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.brand-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), var(--pink));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 2px 12px hsla(var(--accent-h), 80%, 64%, 0.3);
}

.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.4px;
  color: var(--text-primary);
}

.brand-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-glow);
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.3px;
}

.divider {
  height: 1px;
  margin: 4px 18px;
  background: var(--border-subtle);
}

.nav {
  flex: 1;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
  z-index: 1;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 10px;
  text-decoration: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}

.nav-link:hover {
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.03);
}

.nav-link.active {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.04);
}

/* Active glow background */
.nav-link.active::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at left center,
    hsla(var(--accent-h), 60%, 50%, 0.08) 0%,
    transparent 70%
  );
  pointer-events: none;
}

.nav-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle);
  transition: all 0.2s ease;
  color: var(--text-muted);
}

.nav-link:hover .nav-icon-wrap {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
}

.nav-icon-wrap.active {
  background: linear-gradient(135deg,
    hsla(var(--accent-h), 60%, 50%, 0.15),
    hsla(var(--accent-h), 60%, 50%, 0.05)
  );
  border-color: var(--border-accent);
  color: var(--accent);
  box-shadow: 0 0 12px hsla(var(--accent-h), 80%, 60%, 0.1);
}

.nav-label {
  white-space: nowrap;
  letter-spacing: -0.1px;
}

.active-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow-strong);
}

/* ── Bottom ── */
.sidebar-bottom {
  padding-bottom: 12px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
}

.status-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--emerald);
  box-shadow: 0 0 6px hsla(155, 65%, 50%, 0.4);
  animation: pulse 2.5s ease-in-out infinite;
}

.status-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.2px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}
</style>
