/**
 * useReupPreview — CSS preview computation for ALL Reup features.
 *
 * Converts filter toggles into CSS transform + filter strings for live preview.
 * Also provides frame aspect-ratio, title overlay, border, logo, and zoom info.
 *
 * Features with live preview:
 *   ✅ Mirror      → scaleX(-1)
 *   ✅ Crop        → scale(zoom)
 *   ✅ Noise       → url(#grain) SVG filter
 *   ✅ Rotate      → rotate(0.9deg)
 *   ✅ Lens Dist   → perspective distortion
 *   ✅ HDR         → contrast + saturate + brightness
 *   ✅ Speed       → playbackRate
 *   ✅ ColorGrading → CSS hue-rotate, saturate, sepia, grayscale
 *   ✅ Glow/Bloom  → brightness + drop-shadow glow
 *   ✅ Frame       → aspect-ratio CSS class
 *   ✅ Border      → CSS box-shadow inset [NEW]
 *   ✅ Zoom        → CSS animation slowZoom [NEW]
 *   ✅ Logo        → overlay position info [NEW]
 *   ❌ Pitch Shift → audio-only (counted but no visual)
 *   ❌ Volume Boost → audio-only (counted but no visual)
 *   ❌ Split       → post-processing (counted but no visual)
 *   ❌ Title text  → shown as CSS overlay in ReupView template
 */

import { computed, ref, watch, type Ref } from 'vue'
import type {
    ColorGradingStyle, FrameTemplate, TitleTemplate, SplitMode, LogoPosition,
} from '../constants/reup-constants'

interface ReupFilterRefs {
    mirror: Ref<boolean>
    crop: Ref<number>
    cropX: Ref<number>
    cropY: Ref<number>
    noise: Ref<number>
    rotate: Ref<number>
    lensDistortion: Ref<boolean>
    applyHDR: Ref<boolean>
    speed: Ref<number>
    audioEvade: Ref<boolean>
    colorGrading: Ref<ColorGradingStyle>
    glow: Ref<boolean>
    volumeBoost: Ref<number>
    frameTemplate: Ref<FrameTemplate>
    titleTemplate: Ref<TitleTemplate>
    titleText: Ref<string>
    descText: Ref<string>
    splitMode: Ref<SplitMode>
    // New features
    borderWidth: Ref<number>
    borderColor: Ref<string>
    zoomEffect: Ref<boolean>
    zoomIntensity: Ref<number>
    // Pixel-level anti-detect (from Chế Độ 1)
    pixelEnlarge: Ref<number>
    chromaShuffle: Ref<number>
    rgbDrift: Ref<boolean>
    // Advanced anti-detect (0=off, 100=max)
    frameJitter: Ref<number>
    gammaShift: Ref<number>
    microColorCycle: Ref<number>
    dctNoise: Ref<number>
    // Logo
    logoPath: Ref<string>
    logoPosition: Ref<LogoPosition>
    logoSize: Ref<number>
}

export function useReupPreview(filters: ReupFilterRefs) {
    /**
     * Crop zoom factor — extracted separately so it composes with reframe's
     * `scale:` CSS property instead of fighting it via `transform: scale()`.
     */
    const previewCropZoom = computed(() => {
        return { x: 1, y: 1 }
    })

    // SmartCrop preview: clip-path on video element (doesn't cover other layers)
    const previewCropBars = computed(() => {
        const cx = filters.cropX.value
        const cy = filters.cropY.value
        if (cx <= 0 && cy <= 0) return null
        // clip-path: inset(top right bottom left) — crops edges of the video
        const top = cy > 0 ? `${(cy * 100).toFixed(1)}%` : '0%'
        const right = cx > 0 ? `${(cx * 100).toFixed(1)}%` : '0%'
        const bottom = cy > 0 ? `${(cy * 100).toFixed(1)}%` : '0%'
        const left = cx > 0 ? `${(cx * 100).toFixed(1)}%` : '0%'
        return `inset(${top} ${right} ${bottom} ${left})`
    })
    // Keep previewCropStyle for backward compat — now returns clip-path string or null
    const previewCropStyle = computed(() => previewCropBars.value)


const previewTransform = computed(() => {
    const t: string[] = []
    if (filters.mirror.value) t.push('scaleX(-1)')
    // NOTE: crop zoom is in previewCropZoom, NOT here (avoids scale conflict with reframe)
    if (filters.rotate.value !== 0) t.push(`rotate(${filters.rotate.value}deg)`)
    // Lens distortion — perspective warp approximation
    if (filters.lensDistortion.value) t.push('perspective(500px) rotateY(2deg)')
    // Frame Jitter — subtle random translate preview
    if (filters.frameJitter.value > 0) {
        const px = Math.round(3 * filters.frameJitter.value / 100)
        t.push(`translate(${px}px, ${-px}px)`)
    }
    return t.join(' ')
})


/** Pixel Enlarge class — pixelated rendering on video */
const previewPixelClass = computed(() =>
    filters.pixelEnlarge.value > 0 ? 'pixel-enlarge-active' : ''
)

/** CSS filter string (noise, HDR, color grading, glow) */
const previewFilter = computed(() => {
    const f: string[] = []

    // Noise grain — intensity 0-100
    if (filters.noise.value > 0) f.push('url(#grain)')

    // HDR
    if (filters.applyHDR.value) f.push('contrast(1.10) saturate(1.10) brightness(1.01)')

    // Color Grading — CSS approximation of FFmpeg filter chains
    switch (filters.colorGrading.value) {
        case 'vibrant':
            f.push('saturate(1.3) contrast(1.08) brightness(1.05)')
            break
        case 'bw':
            f.push('grayscale(1) contrast(1.15)')
            break
        case 'sepia':
            f.push('sepia(0.6) saturate(1.2) brightness(1.05)')
            break
        case 'cool_blue':
            f.push('saturate(0.85) hue-rotate(15deg) brightness(1.02)')
            break
        case 'warm':
            f.push('brightness(1.03) sepia(0.15) saturate(1.1)')
            break
    }

    // Glow/Bloom — matches FFmpeg: eq=brightness=0.06:contrast=1.05 + vignette + warm colorbalance
    if (filters.glow.value) {
        f.push('brightness(1.06) contrast(1.05) sepia(0.08)')
    }

    // Chroma Shuffle — hue rotation scaled by intensity
    if (filters.chromaShuffle.value > 0) {
        const hueDeg = Math.round(30 * filters.chromaShuffle.value / 100)
        const sat = 1 + 0.25 * (filters.chromaShuffle.value / 100)
        f.push(`hue-rotate(${hueDeg}deg) saturate(${sat.toFixed(2)})`)
    }

    // Pixel Enlarge — contrast + blur scaled by intensity
    if (filters.pixelEnlarge.value > 0) {
        const c = 1 + 0.12 * (filters.pixelEnlarge.value / 100)
        const b = 0.3 + 0.7 * (filters.pixelEnlarge.value / 100)
        f.push(`contrast(${c.toFixed(2)}) blur(${b.toFixed(1)}px)`)
    }

    // Gamma Shift — brightness oscillation preview
    if (filters.gammaShift.value > 0) {
        const shift = 1 + 0.08 * (filters.gammaShift.value / 100)
        f.push(`brightness(${shift.toFixed(3)})`)
    }

    // Micro Color — subtle saturation shift
    if (filters.microColorCycle.value > 0) {
        const sat = 1 + 0.15 * (filters.microColorCycle.value / 100)
        f.push(`saturate(${sat.toFixed(2)})`)
    }

    // DCT Noise — very subtle contrast noise simulation
    if (filters.dctNoise.value > 0) {
        const c = 1 + 0.05 * (filters.dctNoise.value / 100)
        f.push(`contrast(${c.toFixed(3)})`)
    }

    return f.length > 0 ? f.join(' ') : ''
})

/** RGB Drift filter — matches FFmpeg: rgbashift=rh=2:bh=-2 (red/cyan channel shift) */
const previewRgbDriftFilter = computed(() => {
    if (!filters.rgbDrift.value) return ''
    return 'drop-shadow(2px 0 0 rgba(255,0,0,0.4)) drop-shadow(-2px 0 0 rgba(0,200,255,0.4))'
})

/** Video playback rate */
const previewPlaybackRate = computed(() =>
    filters.speed.value !== 1.0 ? filters.speed.value : 1.0
)

/** Frame ratio → CSS class for the preview wrapper */
const previewRatioClass = computed(() => {
    switch (filters.frameTemplate.value) {
        case '9:16': return 'ratio-9-16'
        case '1:1': return 'ratio-1-1'
        case '4:3': return 'ratio-4-3'
        case '3:4': return 'ratio-3-4'
        case '16:9': return 'ratio-16-9'
        default: return ''
    }
})

/** Border preview — CSS box-shadow inset */
const previewBorderStyle = computed(() => {
    if (filters.borderWidth.value <= 0) return {}
    return {
        boxShadow: `inset 0 0 0 ${filters.borderWidth.value}px ${filters.borderColor.value}`,
    }
})

/** Zoom effect — CSS animation class */
const previewZoomClass = computed(() =>
    filters.zoomEffect.value ? 'zoom-active' : ''
)

/** Logo overlay position info — handles 'auto' cycling through 4 corners */
const autoLogoCorners: ('top-left' | 'top-right' | 'bottom-left' | 'bottom-right')[] = [
    'top-left', 'top-right', 'bottom-right', 'bottom-left'
]
const autoLogoIndex = ref(0)
let autoLogoTimer: ReturnType<typeof setInterval> | null = null

// Watch logoPosition — start/stop auto-cycling timer
watch(filters.logoPosition, (pos: string) => {
    if (autoLogoTimer) { clearInterval(autoLogoTimer); autoLogoTimer = null }
    if (pos === 'auto') {
        autoLogoIndex.value = 0
        autoLogoTimer = setInterval(() => {
            autoLogoIndex.value = (autoLogoIndex.value + 1) % 4
        }, 3000) // cycle every 3 seconds
    }
}, { immediate: true })

const previewLogoInfo = computed(() => {
    if (!filters.logoPath.value) return null
    const pos = filters.logoPosition.value === 'auto'
        ? autoLogoCorners[autoLogoIndex.value]
        : filters.logoPosition.value
    return {
        path: filters.logoPath.value,
        position: pos,
        size: filters.logoSize.value,
    }
})

/** Title overlay info — for CSS text preview on the video */
const previewTitleOverlay = computed(() => {
    if (filters.titleTemplate.value === 'none') return null

    const title = filters.titleText.value || 'Sample Title'
    const desc = filters.descText.value || ''

    // Style per template
    const styles: Record<string, { fontWeight: string; fontSize: string; color: string; textShadow: string; position: string }> = {
        bold_center: {
            fontWeight: '900',
            fontSize: '24px',
            color: '#ffffff',
            textShadow: '2px 2px 6px rgba(0,0,0,0.8), -1px -1px 3px rgba(0,0,0,0.5)',
            position: 'center',
        },
        karaoke: {
            fontWeight: '700',
            fontSize: '20px',
            color: '#FFD700',
            textShadow: '1px 1px 4px rgba(0,0,0,0.7)',
            position: 'bottom',
        },
        thin_minimal: {
            fontWeight: '300',
            fontSize: '18px',
            color: 'rgba(255,255,255,0.9)',
            textShadow: '1px 1px 2px rgba(0,0,0,0.4)',
            position: 'bottom',
        },
        neon_glow: {
            fontWeight: '700',
            fontSize: '22px',
            color: '#00ffcc',
            textShadow: '0 0 10px #00ffcc, 0 0 20px #00ffcc, 0 0 40px #00997a',
            position: 'center',
        },
    }

    const style = styles[filters.titleTemplate.value] || styles.bold_center
    return { title, desc, style }
})

/** Count of active filters (all features) */
const activeFilterCount = computed(() => {
    let c = 0
    if (filters.mirror.value) c++
    if (filters.crop.value > 0) c++
    if (filters.noise.value > 0) c++
    if (filters.rotate.value) c++
    if (filters.lensDistortion.value) c++
    if (filters.applyHDR.value) c++
    if (filters.speed.value !== 1.0) c++
    if (filters.audioEvade.value) c++
    c++ // cleanMetadata always on
    if (filters.colorGrading.value !== 'none') c++
    if (filters.glow.value) c++
    if (filters.volumeBoost.value !== 1.0) c++
    if (filters.frameTemplate.value !== 'none') c++
    if (filters.titleTemplate.value !== 'none') c++
    if (filters.borderWidth.value > 0) c++
    if (filters.zoomEffect.value) c++
    if (filters.pixelEnlarge.value) c++
    if (filters.chromaShuffle.value) c++
    if (filters.rgbDrift.value) c++
    if (filters.logoPath.value) c++
    if (filters.splitMode.value !== 'none') c++
    return c
})

return {
    previewTransform,
    previewFilter,
    previewRgbDriftFilter,
    previewPlaybackRate,
    previewRatioClass,
    previewBorderStyle,
    previewZoomClass,
    previewMirrorClass: computed(() => ''),  // kept for API compat, mirror now in previewTransform
    previewPixelClass,
    previewLogoInfo,
    previewTitleOverlay,
    previewCropZoom,
    previewCropStyle,
    previewCropBars,
    activeFilterCount,
}
}
