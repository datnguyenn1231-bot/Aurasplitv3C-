<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits<{ done: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const phase = ref<'loading' | 'fadeout'>('loading')
const progress = ref(0)
const statusText = ref('Đang khởi tạo...')
let animFrame = 0

const steps = [
  { at: 10, text: '⚡ Đang tải engine...' },
  { at: 30, text: '🔧 Kiểm tra GPU...' },
  { at: 50, text: '🛡️ Xác thực bản quyền...' },
  { at: 70, text: '📦 Tải module...' },
  { at: 90, text: '✅ Sẵn sàng!' },
]

function initMatrix() {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')!
  c.width = window.innerWidth
  c.height = window.innerHeight

  const chars = 'AURASPLITアウラ01@#$%ᚠᚡᚢ><{}[]∑∆πΩ'
  const sz = 13
  const cols = Math.floor(c.width / sz)
  const drops: number[] = Array(cols).fill(0).map(() => Math.random() * -50)
  const speeds: number[] = Array(cols).fill(0).map(() => 0.4 + Math.random() * 0.8)

  function draw() {
    ctx.fillStyle = 'rgba(5, 5, 10, 0.07)'
    ctx.fillRect(0, 0, c!.width, c!.height)
    ctx.font = `${sz}px 'Cascadia Code', monospace`

    for (let i = 0; i < drops.length; i++) {
      const ch = chars[Math.floor(Math.random() * chars.length)]
      const x = i * sz
      const y = drops[i] * sz
      const hue = 120 + Math.sin(i * 0.08 + Date.now() * 0.0008) * 35
      ctx.fillStyle = `hsl(${hue}, 100%, ${35 + Math.random() * 25}%)`
      ctx.fillText(ch, x, y)

      if (Math.random() > 0.975) {
        ctx.fillStyle = `hsl(${hue}, 100%, 85%)`
        ctx.fillText(ch, x, y)
      }

      drops[i] += speeds[i]
      if (drops[i] * sz > c!.height && Math.random() > 0.975) drops[i] = 0
    }
    animFrame = requestAnimationFrame(draw)
  }
  draw()
}

onMounted(() => {
  initMatrix()

  // Simulate loading progress
  const interval = setInterval(() => {
    if (progress.value < 100) {
      progress.value += 1 + Math.random() * 3
      if (progress.value > 100) progress.value = 100

      for (const step of steps) {
        if (progress.value >= step.at) statusText.value = step.text
      }
    }

    if (progress.value >= 100) {
      clearInterval(interval)
      statusText.value = '✅ Sẵn sàng!'
      setTimeout(() => {
        phase.value = 'fadeout'
        setTimeout(() => emit('done'), 600)
      }, 400)
    }
  }, 50)
})

onUnmounted(() => {
  if (animFrame) cancelAnimationFrame(animFrame)
})
</script>

<template>
  <div class="splash" :class="{ fadeout: phase === 'fadeout' }">
    <canvas ref="canvas" class="splash-matrix" />

    <div class="splash-content">
      <!-- Logo -->
      <div class="logo-container">
        <div class="logo-ring" />
        <div class="logo-ring ring2" />
        <div class="logo-text">
          <span class="logo-a">A</span>
          <span class="logo-s">S</span>
        </div>
      </div>

      <h1 class="app-name">
        <span class="char" v-for="(c, i) in 'AuraSplit'" :key="i"
          :style="{ animationDelay: i * 0.06 + 's' }">{{ c }}</span>
      </h1>
      <p class="version">v3.0</p>

      <!-- Progress -->
      <div class="progress-container">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: progress + '%' }" />
          <div class="progress-glow" :style="{ left: progress + '%' }" />
        </div>
        <div class="progress-info">
          <span class="progress-text">{{ statusText }}</span>
          <span class="progress-pct">{{ Math.round(progress) }}%</span>
        </div>
      </div>
    </div>

    <!-- Floating particles -->
    <div class="particles">
      <div class="p" v-for="i in 15" :key="i"
        :style="{
          left: Math.random() * 100 + '%',
          animationDelay: Math.random() * 6 + 's',
          animationDuration: 3 + Math.random() * 5 + 's',
        }" />
    </div>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: #050510;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.splash.fadeout {
  opacity: 0;
  transform: scale(1.05);
}

.splash-matrix {
  position: absolute;
  inset: 0;
  opacity: 0.35;
}

.splash-content {
  position: relative;
  z-index: 10;
  text-align: center;
  animation: content-in 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes content-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ═══ Logo ═══ */
.logo-container {
  width: 90px; height: 90px;
  margin: 0 auto 20px;
  position: relative;
}
.logo-ring {
  position: absolute; inset: 0;
  border: 2px solid rgba(0, 255, 65, 0.3);
  border-radius: 50%;
  animation: ring-spin 3s linear infinite;
  border-top-color: #00ff41;
}
.ring2 {
  inset: 8px;
  border-color: rgba(0, 200, 255, 0.2);
  border-top-color: #0cf;
  animation-direction: reverse;
  animation-duration: 2s;
}
@keyframes ring-spin { to { transform: rotate(360deg); } }

.logo-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 28px;
  font-weight: 900;
}
.logo-a { color: #00ff41; text-shadow: 0 0 20px rgba(0, 255, 65, 0.5); }
.logo-s { color: #0cf; text-shadow: 0 0 20px rgba(0, 200, 255, 0.5); }

/* ═══ App Name ═══ */
.app-name {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -1px;
  margin: 0 0 4px;
  color: #e0ffe8;
}
.char {
  display: inline-block;
  animation: char-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes char-in {
  from { opacity: 0; transform: translateY(15px) scale(0.8); filter: blur(4px); }
  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}

.version {
  font-size: 12px;
  color: rgba(0, 255, 65, 0.4);
  font-family: 'Cascadia Code', monospace;
  margin: 0 0 32px;
  letter-spacing: 3px;
}

/* ═══ Progress ═══ */
.progress-container { width: 280px; margin: 0 auto; }
.progress-track {
  position: relative;
  height: 3px;
  background: rgba(0, 255, 65, 0.08);
  border-radius: 3px;
  overflow: visible;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #00c853, #00ff41, #0cf);
  border-radius: 3px;
  transition: width 0.1s linear;
  box-shadow: 0 0 10px rgba(0, 255, 65, 0.4);
}
.progress-glow {
  position: absolute;
  top: -4px;
  width: 8px; height: 11px;
  background: #00ff41;
  border-radius: 50%;
  filter: blur(3px);
  transition: left 0.1s linear;
  box-shadow: 0 0 15px #00ff41;
}
.progress-info {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 11px;
  font-family: 'Cascadia Code', monospace;
}
.progress-text { color: rgba(0, 255, 65, 0.5); }
.progress-pct { color: rgba(0, 255, 65, 0.7); }

/* ═══ Particles ═══ */
.particles { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.p {
  position: absolute; bottom: -5px;
  width: 2px; height: 2px;
  background: #00ff41;
  border-radius: 50%;
  box-shadow: 0 0 4px #00ff41;
  animation: float-up linear infinite;
  opacity: 0;
}
@keyframes float-up {
  0% { transform: translateY(0); opacity: 0; }
  10% { opacity: 0.6; }
  90% { opacity: 0.2; }
  100% { transform: translateY(-100vh); opacity: 0; }
}
</style>
