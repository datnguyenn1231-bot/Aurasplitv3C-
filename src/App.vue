<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import LicenseView from './views/LicenseView.vue'
import SplashScreen from './components/SplashScreen.vue'

const showSplash = ref(true)

// Prevent Electron default file-open behavior for drag-and-drop
// This allows Vue @drop handlers to work normally
onMounted(() => {
  document.addEventListener('dragover', (e) => {
    e.preventDefault()  // Required: tells browser we accept drops
  })
  document.addEventListener('drop', (e) => {
    // Only prevent default (navigation) — don't stop propagation
    // Vue @drop handlers fire BEFORE this (bubble up from element → document)
    e.preventDefault()
  })
})
</script>

<template>
  <!-- Phase 1: Matrix Splash -->
  <SplashScreen v-if="showSplash" @done="showSplash = false" />

  <!-- Phase 2: App (with License Gate overlay if needed) -->
  <div class="app-shell" v-show="!showSplash">
    <!-- Drag bar for window movement (avoids native overlay buttons on right) -->
    <div class="drag-titlebar"></div>
    <LicenseView />
    <Sidebar />
    <main class="main-area">
      <router-view v-slot="{ Component }">
        <transition name="slide" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  padding-top: var(--titlebar-height);
}

/* Drag region — covers titlebar area EXCEPT native overlay buttons on right */
.drag-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 140px; /* leave space for min/max/close buttons */
  height: var(--titlebar-height, 36px);
  -webkit-app-region: drag;
  z-index: 100;
}

.main-area {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
  background: var(--bg-base);
  position: relative;
}

/* Subtle gradient glow at top */
.main-area::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 200px;
  background: radial-gradient(
    ellipse 60% 50% at 50% 0%,
    hsla(var(--accent-h), 60%, 40%, 0.06) 0%,
    transparent 100%
  );
  pointer-events: none;
}
</style>

