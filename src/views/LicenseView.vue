<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Shield, Key, Loader2, CheckCircle2, XCircle } from 'lucide-vue-next'

const licenseKey = ref('')
const status = ref<'idle' | 'checking' | 'activating' | 'valid' | 'invalid'>('checking')
const message = ref('')
const expires = ref('')
const hwid = ref('')
const showKey = ref(false)
const matrixCanvas = ref<HTMLCanvasElement | null>(null)
let animFrame = 0

const api = (window as any).electronAPI
const isValid = computed(() => status.value === 'valid')

// ── Matrix Rain ──
function initMatrix() {
  const canvas = matrixCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight

  const chars = 'AURASPLITv3アウラスプリット0123456789@#$%&*!?><{}[]ᚠᚡᚢᚣᚤᚥ'
  const fontSize = 14
  const cols = Math.floor(canvas.width / fontSize)
  const drops: number[] = Array(cols).fill(0).map(() => Math.random() * -100)
  const speeds: number[] = Array(cols).fill(0).map(() => 0.3 + Math.random() * 0.7)

  function draw() {
    ctx.fillStyle = 'rgba(10, 10, 16, 0.06)'
    ctx.fillRect(0, 0, canvas!.width, canvas!.height)

    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)]
      const x = i * fontSize
      const y = drops[i] * fontSize

      // Gradient green → cyan
      const hue = 120 + Math.sin(i * 0.1 + Date.now() * 0.001) * 40
      const brightness = 40 + Math.random() * 30
      ctx.fillStyle = `hsl(${hue}, 100%, ${brightness}%)`
      ctx.font = `${fontSize}px 'Cascadia Code', monospace`
      ctx.fillText(char, x, y)

      // Head glow (brighter leading char)
      if (Math.random() > 0.97) {
        ctx.fillStyle = `hsl(${hue}, 100%, 85%)`
        ctx.fillText(char, x, y)
      }

      drops[i] += speeds[i]
      if (drops[i] * fontSize > canvas!.height && Math.random() > 0.98) {
        drops[i] = 0
      }
    }
    animFrame = requestAnimationFrame(draw)
  }
  draw()

  window.addEventListener('resize', () => {
    canvas!.width = window.innerWidth
    canvas!.height = window.innerHeight
  })
}

async function checkLicense() {
  status.value = 'checking'
  message.value = 'Đang kiểm tra license...'
  try {
    const result = await api.licenseCheck()
    if (result.valid) {
      status.value = 'valid'
      message.value = result.message
      expires.value = result.expires || 'LIFETIME'
    } else {
      status.value = result.needsActivation ? 'idle' : 'invalid'
      message.value = result.message
    }
  } catch {
    status.value = 'idle'
    message.value = 'Lỗi kiểm tra license'
  }
}

async function activate() {
  if (!licenseKey.value.trim()) return
  status.value = 'activating'
  message.value = 'Đang kích hoạt...'
  try {
    const result = await api.licenseActivate(licenseKey.value.trim())
    if (result.success) {
      status.value = 'valid'
      message.value = result.message
      await checkLicense()
    } else {
      status.value = 'invalid'
      message.value = result.message
    }
  } catch {
    status.value = 'invalid'
    message.value = 'Lỗi kết nối server'
  }
}

async function deactivate() {
  await api.licenseDeactivate()
  status.value = 'idle'
  message.value = 'License đã được gỡ bỏ'
  licenseKey.value = ''
  expires.value = ''
}

async function loadHWID() {
  try {
    const r = await api.licenseHWID()
    hwid.value = r.hwid
  } catch { hwid.value = 'N/A' }
}

function handleKeyInput(e: KeyboardEvent) {
  if (e.key === 'Enter') activate()
}

onMounted(async () => {
  await loadHWID()
  await checkLicense()
  if (!isValid.value) initMatrix()
})

onUnmounted(() => {
  if (animFrame) cancelAnimationFrame(animFrame)
})
</script>

<template>
  <div class="license-gate" v-if="!isValid">
    <!-- Matrix Rain Background -->
    <canvas ref="matrixCanvas" class="matrix-bg" />

    <!-- Floating particles -->
    <div class="particles">
      <div class="particle" v-for="i in 20" :key="i"
        :style="{
          left: Math.random() * 100 + '%',
          animationDelay: Math.random() * 8 + 's',
          animationDuration: 4 + Math.random() * 6 + 's',
        }"
      />
    </div>

    <!-- Card -->
    <div class="license-card">
      <!-- Glowing border -->
      <div class="card-glow" />

      <div class="card-header">
        <div class="icon-wrap pulse">
          <Shield :size="28" />
        </div>
        <h1 class="glitch" data-text="AuraSplit License">AuraSplit License</h1>
        <p class="subtitle typing">Nhập key để kích hoạt phần mềm</p>
      </div>

      <!-- Status -->
      <div class="status-bar" :class="status">
        <Loader2 v-if="status === 'checking' || status === 'activating'" :size="16" class="spin" />
        <CheckCircle2 v-else-if="status === 'valid'" :size="16" />
        <XCircle v-else-if="status === 'invalid'" :size="16" />
        <Key v-else :size="16" />
        <span>{{ message || 'Chưa kích hoạt' }}</span>
      </div>

      <!-- Key Input -->
      <div class="input-group">
        <input
          v-model="licenseKey"
          :type="showKey ? 'text' : 'password'"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          class="key-input"
          @keyup="handleKeyInput"
          :disabled="status === 'checking' || status === 'activating'"
        />
        <button class="btn-eye" @click="showKey = !showKey">
          {{ showKey ? '🙈' : '👁️' }}
        </button>
      </div>

      <button class="btn-activate" :disabled="!licenseKey.trim() || status === 'checking' || status === 'activating'" @click="activate">
        <Loader2 v-if="status === 'activating'" :size="16" class="spin" />
        <Key v-else :size="16" />
        {{ status === 'activating' ? 'Đang kích hoạt...' : '🔑 Kích hoạt' }}
      </button>

      <!-- HWID -->
      <div class="hwid-bar">
        <span class="hwid-label">HWID:</span>
        <code class="hwid-value">{{ hwid || '...' }}</code>
      </div>

      <!-- Scanline effect -->
      <div class="scanline" />
    </div>
  </div>

  <!-- Valid badge -->
  <div v-else class="license-badge valid" @click="deactivate" title="Nhấn để hủy kích hoạt">
    <CheckCircle2 :size="12" />
    <span>{{ expires === 'LIFETIME' ? '♾️ Vĩnh viễn' : `⏳ ${expires}` }}</span>
  </div>
</template>

<style scoped>
/* ═══ Gate ═══ */
.license-gate {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #0a0a10;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* ═══ Matrix Canvas ═══ */
.matrix-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.4;
}

/* ═══ Floating Particles ═══ */
.particles { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.particle {
  position: absolute;
  bottom: -10px;
  width: 2px;
  height: 2px;
  background: #00ff41;
  border-radius: 50%;
  box-shadow: 0 0 6px #00ff41, 0 0 12px #00ff4180;
  animation: float-up linear infinite;
  opacity: 0;
}
@keyframes float-up {
  0% { transform: translateY(0); opacity: 0; }
  10% { opacity: 0.8; }
  90% { opacity: 0.3; }
  100% { transform: translateY(-100vh); opacity: 0; }
}

/* ═══ Card ═══ */
.license-card {
  position: relative;
  z-index: 10;
  width: 440px;
  background: rgba(10, 10, 20, 0.85);
  border: 1px solid rgba(0, 255, 65, 0.15);
  border-radius: 20px;
  padding: 40px 36px;
  backdrop-filter: blur(20px);
  box-shadow:
    0 0 40px rgba(0, 255, 65, 0.05),
    0 20px 60px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(0, 255, 65, 0.1);
  animation: card-enter 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}
@keyframes card-enter {
  from { opacity: 0; transform: translateY(30px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Animated border glow */
.card-glow {
  position: absolute;
  inset: -1px;
  border-radius: 20px;
  background: conic-gradient(from var(--angle, 0deg), transparent, #00ff41, transparent, #00ff41, transparent);
  opacity: 0.15;
  z-index: -1;
  animation: rotate-glow 4s linear infinite;
}
@keyframes rotate-glow {
  to { --angle: 360deg; }
}
@property --angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

/* Scanline */
.scanline {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(0, 255, 65, 0.15), transparent);
  animation: scan 3s ease-in-out infinite;
  pointer-events: none;
}
@keyframes scan {
  0%, 100% { top: 0; opacity: 0; }
  50% { opacity: 1; }
  100% { top: 100%; }
}

/* ═══ Header ═══ */
.card-header { text-align: center; margin-bottom: 28px; }

.icon-wrap {
  width: 60px; height: 60px;
  border-radius: 16px;
  background: linear-gradient(135deg, #00c853, #00ff41);
  display: flex; align-items: center; justify-content: center;
  color: #0a0a10;
  margin: 0 auto 16px;
  box-shadow: 0 4px 24px rgba(0, 255, 65, 0.3), 0 0 40px rgba(0, 255, 65, 0.1);
}
.icon-wrap.pulse { animation: pulse-glow 2s ease-in-out infinite; }
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 4px 24px rgba(0, 255, 65, 0.3); }
  50% { box-shadow: 0 4px 40px rgba(0, 255, 65, 0.5), 0 0 60px rgba(0, 255, 65, 0.15); }
}

.card-header h1 {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
  margin: 0;
  color: #e0ffe8;
  text-shadow: 0 0 20px rgba(0, 255, 65, 0.2);
}

/* Glitch effect */
.glitch {
  position: relative;
  animation: glitch-skew 6s infinite linear alternate-reverse;
}
.glitch::before, .glitch::after {
  content: attr(data-text);
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  opacity: 0.8;
}
.glitch::before {
  color: #0ff;
  animation: glitch-anim 3s infinite linear alternate-reverse;
  clip-path: inset(0 0 80% 0);
}
.glitch::after {
  color: #f0f;
  animation: glitch-anim2 2.5s infinite linear alternate-reverse;
  clip-path: inset(80% 0 0 0);
}
@keyframes glitch-skew {
  0%, 95% { transform: skew(0deg); }
  96% { transform: skew(2deg); }
  98% { transform: skew(-1deg); }
  100% { transform: skew(0deg); }
}
@keyframes glitch-anim {
  0%, 90% { transform: translate(0); }
  92% { transform: translate(-2px, 1px); }
  94% { transform: translate(2px, -1px); }
  96% { transform: translate(-1px, 2px); }
  100% { transform: translate(0); }
}
@keyframes glitch-anim2 {
  0%, 88% { transform: translate(0); }
  90% { transform: translate(2px, 1px); }
  94% { transform: translate(-2px, -1px); }
  100% { transform: translate(0); }
}

.subtitle {
  font-size: 13px;
  color: rgba(0, 255, 65, 0.5);
  margin: 8px 0 0;
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
}

/* ═══ Status ═══ */
.status-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 10px;
  font-size: 13px; font-weight: 500;
  margin-bottom: 20px;
  transition: all 0.3s;
  font-family: 'Cascadia Code', monospace;
}
.status-bar.idle { background: rgba(0, 255, 65, 0.05); color: rgba(0, 255, 65, 0.6); border: 1px solid rgba(0, 255, 65, 0.1); }
.status-bar.checking, .status-bar.activating { background: rgba(0, 200, 255, 0.05); color: #0cf; border: 1px solid rgba(0, 200, 255, 0.15); }
.status-bar.valid { background: rgba(0, 255, 65, 0.08); color: #00ff41; border: 1px solid rgba(0, 255, 65, 0.2); }
.status-bar.invalid { background: rgba(255, 50, 50, 0.08); color: #ff4444; border: 1px solid rgba(255, 50, 50, 0.2); }

/* ═══ Input ═══ */
.input-group { display: flex; gap: 6px; margin-bottom: 14px; }
.key-input {
  flex: 1; padding: 13px 16px; border-radius: 12px;
  border: 1px solid rgba(0, 255, 65, 0.12);
  background: rgba(0, 255, 65, 0.03);
  color: #00ff41;
  font-size: 15px;
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  letter-spacing: 2px; outline: none;
  transition: all 0.3s;
  caret-color: #00ff41;
}
.key-input:focus {
  border-color: #00ff41;
  box-shadow: 0 0 0 3px rgba(0, 255, 65, 0.1), 0 0 20px rgba(0, 255, 65, 0.05);
}
.key-input::placeholder { color: rgba(0, 255, 65, 0.2); letter-spacing: 3px; }

.btn-eye {
  width: 44px; border-radius: 12px;
  border: 1px solid rgba(0, 255, 65, 0.12);
  background: rgba(0, 255, 65, 0.03);
  cursor: pointer; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.btn-eye:hover { background: rgba(0, 255, 65, 0.08); border-color: rgba(0, 255, 65, 0.3); }

/* ═══ Button ═══ */
.btn-activate {
  width: 100%; padding: 14px; border-radius: 12px; border: none;
  background: linear-gradient(135deg, #00c853, #00ff41);
  color: #0a0a10;
  font-size: 15px; font-weight: 700; font-family: inherit;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all 0.3s; margin-bottom: 20px;
  text-shadow: 0 1px 0 rgba(0, 255, 65, 0.3);
  box-shadow: 0 4px 20px rgba(0, 255, 65, 0.2);
}
.btn-activate:hover:not(:disabled) {
  box-shadow: 0 6px 30px rgba(0, 255, 65, 0.4);
  transform: translateY(-2px);
}
.btn-activate:active:not(:disabled) { transform: translateY(0); }
.btn-activate:disabled { opacity: 0.3; cursor: not-allowed; }

/* ═══ HWID ═══ */
.hwid-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  background: rgba(0, 255, 65, 0.02);
  border: 1px solid rgba(0, 255, 65, 0.06);
}
.hwid-label { font-size: 10px; color: rgba(0, 255, 65, 0.4); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
.hwid-value { font-size: 11px; color: rgba(0, 255, 65, 0.5); font-family: 'Cascadia Code', monospace; user-select: all; }

/* ═══ Badge ═══ */
.license-badge {
  position: fixed; bottom: 12px; right: 12px; z-index: 100;
  display: flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 20px;
  font-size: 10px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; opacity: 0.6;
}
.license-badge:hover { opacity: 1; }
.license-badge.valid { background: rgba(0, 255, 65, 0.08); color: #00ff41; border: 1px solid rgba(0, 255, 65, 0.15); }

/* ═══ Animations ═══ */
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
