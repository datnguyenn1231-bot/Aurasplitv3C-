/**
 * Reup Constants — Enhanced Anti-Detection Pipeline config.
 * Includes 12 filter layers + Frame Templates + Title Templates.
 */

export type ColorGradingStyle = 'none' | 'vibrant' | 'bw' | 'sepia' | 'cool_blue' | 'warm'

/** Ratio — aspect ratio conversion applied to output */
export type FrameTemplate = 'none' | '9:16' | '1:1' | '4:3' | '3:4' | '16:9'

/** Title template — text overlay style */
export type TitleTemplate = 'none' | 'bold_center' | 'karaoke' | 'thin_minimal' | 'neon_glow' | 'dynamic_caption'

/** Subtitle animation style */
export type SubAnimation = 'none' | 'fade' | 'pop' | 'slide_up' | 'karaoke' | 'typewriter' | 'bounce' | 'word_pop'

/** Subtitle animation options for UI */
export const SUB_ANIMATION_OPTIONS: { value: SubAnimation; label: string; desc: string }[] = [
    { value: 'none', label: '— None', desc: 'Không animation' },
    { value: 'fade', label: '✨ Fade', desc: 'Mờ dần xuất hiện' },
    { value: 'pop', label: '💥 Pop', desc: 'Phóng to nảy vào' },
    { value: 'slide_up', label: '⬆️ Slide Up', desc: 'Trượt lên từ dưới' },
    { value: 'karaoke', label: '🎤 Karaoke', desc: 'Highlight từng từ' },
    { value: 'typewriter', label: '⌨️ Typewriter', desc: 'Gõ từng chữ' },
    { value: 'bounce', label: '🏀 Bounce', desc: 'Nảy vào từ trên' },
    { value: 'word_pop', label: '🎯 Dynamic Caption', desc: 'Nhóm từ pop + random màu' },
]

/** Subtitle position on screen */
export type SubPosition = 'top' | 'center' | 'bottom'

/** Subtitle position options for UI */
export const SUB_POSITION_OPTIONS: { value: SubPosition; label: string }[] = [
    { value: 'top', label: '⬆️ Top' },
    { value: 'center', label: '⏺ Center' },
    { value: 'bottom', label: '⬇️ Bottom' },
]

/** Logo position — corner placement */
export type LogoPosition = 'auto' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** Split mode — applied post-processing in same pipeline */
export type SplitMode = 'none' | 'half' | 'segments'

export interface ReupConfig {
    inputFolder: string
    // Original 9 layers
    mirror: boolean
    crop: number           // 0 to 0.30 (0% to 30%) — legacy uniform crop
    cropX: number          // 0 to 0.30 — horizontal crop amount
    cropY: number          // 0 to 0.30 — vertical crop amount
    noise: number            // 0 = off, 1-100 grain intensity
    rotate: number         // 0 = off, -10 to 10 degrees
    lensDistortion: boolean
    hdr: boolean
    speed: number          // 0.5 to 3.0
    audioEvade: boolean    // Lách âm thanh — combo pitch+channel+EQ+echo
    cleanMetadata: boolean // always true
    musicPath: string
    // New from Chế Độ 1
    colorGrading: ColorGradingStyle
    glow: boolean
    volumeBoost: number    // 1.0 to 2.0
    // Templates
    frameTemplate: FrameTemplate
    titleTemplate: TitleTemplate
    titleText: string      // custom title (empty = use filename)
    descText: string       // description / part text
    // Frame effects
    borderWidth: number       // 0 to 20 pixels
    borderColor: string       // hex color
    zoomEffect: boolean       // Ken Burns slow zoom
    zoomIntensity: number     // 1.0 to 1.5
    // Pixel-level anti-detect (0=off, 100=max)
    pixelEnlarge: number          // scale up/down with neighbor → changes every pixel
    chromaShuffle: number         // YUV hue rotation + saturation boost
    rgbDrift: boolean             // per-channel ±2px shift (stays boolean)
    // Advanced anti-detect (0=off, 100=max)
    frameJitter: number           // random pixel shift per frame
    gammaShift: number            // subtle gamma curve shift per frame
    microColorCycle: number       // per-frame UV shift
    dctNoise: number              // 8x8 block-position-dependent noise
    // Logo watermark
    logoPath: string          // path to image file
    logoPosition: LogoPosition
    logoSize: number          // 5 to 30 (% of video width)
    // Split (post-processing)
    splitMode: SplitMode
    segmentLength: number  // seconds, used when splitMode = 'segments'
    // Chia Part
    splitEnabled?: boolean
    splitDuration?: number
    splitShowTitle?: boolean
    splitShowPart?: boolean
    // Overlay + Background
    overlayPath?: string          // folder containing overlay videos
    overlayOpacity?: number       // 0-100
    overlayRandom?: boolean       // random pick per video
    bgBlur?: boolean              // background blur on/off
    bgBlurAmount?: number         // blur intensity (px)
    // Anti-detect arsenal (Auto Pipeline only)
    hueShift?: number             // subtle hue rotation 1-3°
    microZoom?: number            // 1.01-1.03x zoom + crop back
    fadeInOut?: number            // fade duration 0.2-0.5s
    ptsJitter?: boolean           // ±2ms timestamp jitter per frame
    microTempo?: number           // 1.005-1.015 audio tempo
    deviceProfile?: string        // 'iphone15pro' | 'iphone14' | 'samsung_s24' | 'generic'
    brightnessShift?: number      // ±0.02 brightness
    contrastShift?: number        // ±0.02 contrast
    saturationShift?: number      // 0.95-1.05 saturation
    vignette?: boolean            // subtle corner darkening
    colorTemp?: string            // 'warm' | 'cool' | 'none'
}

/** Defaults: clean slate — user selects what they want */
export const REUP_DEFAULTS: Omit<ReupConfig, 'inputFolder' | 'musicPath'> = {
    mirror: false,
    crop: 0,
    cropX: 0,
    cropY: 0,
    noise: 0,
    rotate: 0,
    lensDistortion: false,
    hdr: false,
    speed: 1.0,
    audioEvade: false,
    cleanMetadata: true,
    colorGrading: 'none',
    glow: false,
    volumeBoost: 1.0,
    frameTemplate: 'none',
    titleTemplate: 'none',
    titleText: '',
    descText: '',
    borderWidth: 0,
    borderColor: '#000000',
    zoomEffect: false,
    zoomIntensity: 1.15,
    pixelEnlarge: 0,
    chromaShuffle: 0,
    rgbDrift: false,
    frameJitter: 0,
    gammaShift: 0,
    microColorCycle: 0,
    dctNoise: 0,
    logoPath: '',
    logoPosition: 'bottom-right',
    logoSize: 12,
    splitMode: 'none',
    segmentLength: 15,
}

/** Color grading style labels for UI */
export const COLOR_GRADING_OPTIONS: { value: ColorGradingStyle; label: string }[] = [
    { value: 'none', label: 'Không' },
    { value: 'vibrant', label: '🎨 Rực rỡ HDR' },
    { value: 'warm', label: '🌅 Tông ấm' },
    { value: 'sepia', label: '🟤 Sepia ấm' },
    { value: 'cool_blue', label: '❄️ Xanh lạnh' },
]

/** Ratio options for UI dropdown */
export const FRAME_TEMPLATE_OPTIONS: { value: FrameTemplate; label: string; desc: string }[] = [
    { value: 'none', label: 'None', desc: 'Giữ nguyên khung gốc' },
    { value: '9:16', label: '📱 9:16 TikTok', desc: '1080×1920 — dọc' },
    { value: '1:1', label: '⬛ 1:1 Square', desc: '1080×1080 — vuông' },
    { value: '4:3', label: '📺 4:3', desc: 'Cổ điển' },
    { value: '3:4', label: '📋 3:4', desc: 'Portrait nhẹ' },
    { value: '16:9', label: '🖥️ 16:9 YouTube', desc: '1920×1080 — ngang' },
]

/** Title template options for UI */
export const TITLE_TEMPLATE_OPTIONS: { value: TitleTemplate; label: string; desc: string; preview: string }[] = [
    { value: 'none', label: 'None', desc: 'Không thêm text', preview: '' },
    { value: 'bold_center', label: '🔤 Bold Center', desc: 'Montserrat Black, viền đen', preview: 'TITLE · desc bottom' },
    { value: 'karaoke', label: '🎤 Karaoke', desc: 'Poppins Bold, vàng gold', preview: 'WORD by WORD' },
    { value: 'thin_minimal', label: '✏️ Thin Sharp', desc: 'Poppins 600, trắng sạch', preview: 'Title — desc' },
    { value: 'neon_glow', label: '💫 Neon Glow', desc: 'Bangers, neon xanh', preview: '~ TITLE ~' },
    { value: 'dynamic_caption', label: '🎯 Dynamic', desc: 'Từng nhóm từ pop + màu', preview: 'WORD POP' },
]

// ═════════════════════════════════════════════════════════
// 4-LAYER ANTI-DETECT DEFENSE SYSTEM
// Each layer targets a specific platform detection method
// ═════════════════════════════════════════════════════════

/** Preset = partial config (only fields that should change) */
export type ReupPresetValues = Partial<Omit<ReupConfig, 'inputFolder' | 'musicPath' | 'cleanMetadata' | 'splitMode' | 'segmentLength'>>

/** Anti-detect layer definition */
export interface AntiDetectLayer {
    id: string
    label: string
    emoji: string
    desc: string
    shortDesc: string  // filter summary for UI card
    values: ReupPresetValues
}

/**
 * 4-Layer Defense System:
 * L2 🖼️ Visual Fingerprint — bypass pHash/dHash comparison
 * L3 🧠 Deep Learning      — change CNN embedding vector
 * L4 ⏱️ Temporal Pattern   — break keyframe sequence matching
 * L5 🔬 Pixel Forensic     — bypass exact pixel/metadata analysis
 */
export const ANTI_DETECT_LAYERS: AntiDetectLayer[] = [
    {
        id: 'L2_visual',
        label: 'Dấu vân hình ảnh',
        emoji: '🖼️',
        desc: 'Bypass pHash/dHash — thay đổi perceptual hash',
        shortDesc: 'Crop · Rotate · Color · Border · PixelEnlarge · RGB Drift · FrameJitter',
        values: {
            crop: 0.04, cropX: 0.04, cropY: 0.04, rotate: 2, colorGrading: 'vibrant',
            borderWidth: 3, borderColor: '#000000',
            pixelEnlarge: 100, rgbDrift: true,
            frameJitter: 40,  // subtle pixel shift per frame
        },
    },
    {
        id: 'L3_deeplearn',
        label: 'Học sâu AI',
        emoji: '🧠',
        desc: 'Thay đổi CNN embedding — thêm nội dung mới vào frame',
        shortDesc: 'Frame 9:16 · Zoom Effect · Glow',
        values: {
            frameTemplate: '9:16', zoomEffect: true, zoomIntensity: 1.15,
            glow: true,
        },
    },
    {
        id: 'L4_temporal',
        label: 'Mẫu thời gian',
        emoji: '⏱️',
        desc: 'Phá temporal fingerprint — đổi trình tự keyframes',
        shortDesc: 'Speed 1.05x · Audio Evade',
        values: {
            speed: 1.05, audioEvade: true,
        },
    },
    {
        id: 'L5_forensic',
        label: 'Phân tích pixel',
        emoji: '🔬',
        desc: 'Bypass pixel analysis — thay đổi từng pixel',
        shortDesc: 'Mirror · Lens · HDR · ChromaShuffle · GammaShift · MicroColor · DCT',
        values: {
            mirror: true, lensDistortion: true, hdr: true,
            chromaShuffle: 100,
            gammaShift: 60,       // gamma curve oscillation
            microColorCycle: 50,  // per-frame UV shift
            dctNoise: 45,         // 8x8 block noise
        },
    },
]

/** Reset preset — clears all filters back to defaults */
export const RESET_PRESET: ReupPresetValues = {
    mirror: false, crop: 0, cropX: 0, cropY: 0, noise: 0, rotate: 0,
    lensDistortion: false, hdr: false, speed: 1.0, audioEvade: false,
    colorGrading: 'none', glow: false, volumeBoost: 1.0,
    frameTemplate: 'none',
    zoomEffect: false, zoomIntensity: 1.15,
    borderWidth: 0, borderColor: '#000000',
    titleTemplate: 'none', titleText: '', descText: '',
    logoPath: '', logoPosition: 'bottom-right', logoSize: 12,
    pixelEnlarge: 0, chromaShuffle: 0, rgbDrift: false,
    frameJitter: 0, gammaShift: 0, microColorCycle: 0, dctNoise: 0,
}

/** Keep old REUP_PRESETS for backward compat (custom presets use this type) */
export interface ReupPreset {
    id: string
    label: string
    emoji: string
    desc: string
    values: ReupPresetValues
}


