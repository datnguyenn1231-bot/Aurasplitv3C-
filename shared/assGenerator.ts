/**
 * assGenerator.ts — Shared ASS subtitle generation service
 *
 * Single source of truth for generating ASS subtitle content.
 * Used by both:
 *   - Preview (libass-wasm / SubtitlesOctopus) — real-time in browser
 *   - Export  (FFmpeg / NVEncC --vpp-subburn)   — written to .ass file
 *
 * This ensures 100% parity between preview and export.
 */

// ── Types ────────────────────────────────────────────────────────────

export type SubStyle = 'bold_center' | 'karaoke' | 'thin_minimal' | 'neon_glow' | 'dynamic_caption' | 'none'
export type SubAnimation = 'fade' | 'pop' | 'bounce' | 'slide_up' | 'karaoke' | 'typewriter' | 'none'
export type SubPosition = 'bottom' | 'center' | 'top'

export interface SubtitleSegment {
    startSec: number
    endSec: number
    text: string
}

export interface AssGeneratorConfig {
    /** Parsed subtitle segments (already converted from SRT) */
    segments: SubtitleSegment[]
    /** Subtitle style */
    style: SubStyle
    /** Animation type */
    animation: SubAnimation
    /** Position on screen */
    position: SubPosition
    /** Font size in CSS px (relative to preview container height) */
    fontSize: number
    /** Preview container height in px (used for scaling) */
    previewHeight: number
    /** Horizontal offset in CSS px */
    offsetX: number
    /** Vertical offset in CSS px */
    offsetY: number
    /** ASS PlayResX (1080 for both preview + export) */
    playResX: number
    /** ASS PlayResY (1920 for both preview + export) */
    playResY: number
    /** Video speed multiplier (1.0 = normal, 1.1 = 10% faster). Subtitle times are divided by this. */
    speed?: number
}

// ── Constants ────────────────────────────────────────────────────────

// ── CJK Detection ─────────────────────────────────────────────────
/** Detect if text contains CJK characters (Japanese, Chinese, Korean) */
function hasCJK(text: string): boolean {
    // CJK Unified Ideographs, Hiragana, Katakana, Hangul, CJK symbols
    return /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(text)
}
const CJK_FONT = 'Noto Sans JP'

const WORD_POP_COLORS_ASS = [
    '&H0000D7FF',  // #FFD700 gold
    '&H00FFE500',  // #00E5FF cyan
    '&H008140FF',  // #FF4081 pink
    '&H0003FF76',  // #76FF03 green
    '&H000091FF',  // #FF9100 orange
    '&H00FF8A44',  // #448AFF blue
    '&H004417FF',  // #FF1744 red
    '&H00FB40E0',  // #E040FB purple
]

// ── Helpers ──────────────────────────────────────────────────────────

/** Seconds → ASS timestamp H:MM:SS.cc */
function secToAss(sec: number): string {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    const cs = Math.floor((sec % 1) * 100)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** Deterministic pseudo-random (same algo as CSS preview) */
function makeRand(text: string): () => number {
    let seed = 0
    for (let i = 0; i < text.length; i++) seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0
    return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 100) / 100 }
}

/**
 * Parse SRT content into SubtitleSegment[]
 */
export function parseSrt(srtContent: string): SubtitleSegment[] {
    const blocks = srtContent.replace(/\r\n/g, '\n').trim().split(/\n\n+/)
    const segments: SubtitleSegment[] = []

    for (const block of blocks) {
        const lines = block.trim().split('\n')
        let timeLine = -1
        for (let j = 0; j < Math.min(lines.length, 3); j++) {
            if (lines[j].includes('-->')) { timeLine = j; break }
        }
        if (timeLine < 0) continue

        const tm = lines[timeLine].match(/(\d{2}:\d{2}:\d{2})[,.](\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2})[,.](\d{3})/)
        if (!tm) continue

        const text = lines.slice(timeLine + 1).join(' ').trim()
        if (!text) continue

        const [h1, m1, s1] = tm[1].split(':').map(Number)
        const [h2, m2, s2] = tm[3].split(':').map(Number)
        const startSec = h1 * 3600 + m1 * 60 + s1 + parseInt(tm[2]) / 1000
        const endSec = h2 * 3600 + m2 * 60 + s2 + parseInt(tm[4]) / 1000

        segments.push({ startSec, endSec, text })
    }
    return segments
}

// ── Main Generator ───────────────────────────────────────────────────

/**
 * Generate complete ASS subtitle content string.
 * Used by both preview (libass-wasm) and export (FFmpeg/NVEncC).
 */
export function generateAssString(config: AssGeneratorConfig): string {
    const dialogues: string[] = []
    const isDynamic = config.style === 'dynamic_caption'
    // Speed factor: divide all timestamps by speed to sync with sped-up video
    const spd = (config.speed && config.speed !== 1.0) ? config.speed : 1.0

    // ── Build dialogue lines ──

    for (const seg of config.segments) {
        // Adjust timestamps for speed (preview uses 1.0, export uses actual speed)
        const startSec = seg.startSec / spd
        const endSec = seg.endSec / spd
        const text = seg.text

        if (isDynamic) {
            // Dynamic Caption: split into word groups, each shown one at a time
            const words = text.split(/\s+/).filter(w => w.length > 0)
            if (words.length === 0) continue
            const rand = makeRand(text)

            // Build groups (1-4 words each, matching preview logic)
            const groups: Array<{ text: string; colorIdx: number }> = []
            let idx = 0, lastCI = -1
            while (idx < words.length) {
                const rem = words.length - idx
                const gsz = rem <= 2 ? rem : Math.max(1, Math.min(4, Math.floor(rand() * 4) + 1))
                const chunk = words.slice(idx, idx + gsz).join(' ')
                let ci = Math.floor(rand() * WORD_POP_COLORS_ASS.length)
                if (ci === lastCI) ci = (ci + 1) % WORD_POP_COLORS_ASS.length
                lastCI = ci
                groups.push({ text: chunk, colorIdx: ci })
                idx += gsz
            }

            // Timing: each group gets equal share of 80% of segment
            const segDur = endSec - startSec
            const activeTime = segDur * 0.8
            const gInterval = groups.length > 1 ? activeTime / groups.length : activeTime

            for (let gi = 0; gi < groups.length; gi++) {
                const gStart = startSec + gi * gInterval
                const gEnd = gi < groups.length - 1 ? startSec + (gi + 1) * gInterval - 0.05 : endSec
                const color = WORD_POP_COLORS_ASS[groups[gi].colorIdx]
                const gText = groups[gi].text.toUpperCase()
                // Adaptive pop: ≤2 words gets dramatic scale, longer gets subtle
                const dur = Math.round((gEnd - gStart) * 1000)
                const t1 = Math.min(180, Math.round(dur * 0.15))
                const t2 = Math.min(300, Math.round(dur * 0.25))
                const t3 = Math.min(400, Math.round(dur * 0.35))
                const wordCount = gText.split(/\s+/).length
                const popTag = wordCount <= 2
                    ? `{\\c${color}\\fscx0\\fscy0\\t(0,${t1},\\fscx110\\fscy110)\\t(${t1},${t2},\\fscx95\\fscy95)\\t(${t2},${t3},\\fscx100\\fscy100)\\fad(50,80)}`
                    : `{\\c${color}\\alpha&HFF&\\t(0,${t1},\\alpha&H00&)\\fscx93\\fscy93\\t(0,${t2},\\fscx106\\fscy106)\\t(${t2},${t3},\\fscx100\\fscy100)\\fad(0,80)}`
                dialogues.push(`Dialogue: 0,${secToAss(gStart)},${secToAss(gEnd)},Default,,0,0,0,,${popTag}${gText}`)
            }
        } else {
            // Standard styles: full text with animation
            const start = secToAss(startSec)
            const end = secToAss(endSec)
            const isUpper = config.style === 'bold_center'
            const displayText = isUpper ? text.toUpperCase() : text

            if (config.animation === 'karaoke') {
                // Karaoke: per-word timing with \kf tags
                const words = displayText.split(/\s+/).filter(w => w.length > 0)
                const segDur = endSec - startSec
                const wordDurCs = Math.round((segDur / words.length) * 100)
                const karaokeText = words.map(w => `{\\kf${wordDurCs}}${w}`).join(' ')
                dialogues.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${karaokeText}`)
            } else if (config.animation === 'typewriter') {
                // Typewriter: progressive character reveal (matches old CSS)
                const segDur = endSec - startSec
                const revealDur = segDur * 0.7
                const chars = displayText.split('')
                if (chars.length === 0) continue
                const charInterval = revealDur / chars.length
                const isNeon = config.style === 'neon_glow'

                for (let ci = 0; ci < chars.length; ci++) {
                    const charStart = startSec + ci * charInterval
                    const shown = displayText.slice(0, ci + 1)
                    const charEnd = ci < chars.length - 1
                        ? startSec + (ci + 1) * charInterval
                        : endSec
                    const cursor = ci < chars.length - 1 ? '|' : ''
                    const cs = secToAss(charStart)
                    const ce = secToAss(charEnd)

                    if (isNeon) {
                        // Neon glow multi-layer for each typewriter step
                        dialogues.push(`Dialogue: 0,${cs},${ce},Default,,0,0,0,,{\\blur30\\bord0\\shad0\\1c&H00CCFF00&\\1a&H50&}${shown}${cursor}`)
                        dialogues.push(`Dialogue: 1,${cs},${ce},Default,,0,0,0,,{\\blur18\\bord0\\shad0\\1c&H00CCFF00&\\1a&H18&}${shown}${cursor}`)
                        dialogues.push(`Dialogue: 2,${cs},${ce},Default,,0,0,0,,{\\blur6\\bord3\\shad0\\1c&H00CCFF00&\\3c&H00CCFF00&}${shown}${cursor}`)
                        dialogues.push(`Dialogue: 3,${cs},${ce},Default,,0,0,0,,{\\blur0.4\\bord2\\shad0\\1c&H00CCFF00&\\3c&H00000000&}${shown}${cursor}`)
                    } else {
                        const fadeTag = ci === 0 ? '{\\fad(150,0)}' : ''
                        dialogues.push(`Dialogue: 0,${cs},${ce},Default,,0,0,0,,${fadeTag}${shown}${cursor}`)
                    }
                }
            } else {
                // ── Build animation override tags ──
                // NOTE: avoid accel parameter in \t — libass-wasm doesn't handle it reliably
                let animTag = '{\\fad(300,200)}'
                if (config.animation === 'pop') {
                    // Adaptive pop: short text gets dramatic scale(0→120%), long text gets subtle ±6%
                    const isShort = displayText.length <= 30
                    animTag = isShort
                        ? '{\\fscx0\\fscy0\\t(0,180,\\fscx120\\fscy120)\\t(180,320,\\fscx95\\fscy95)\\t(320,420,\\fscx100\\fscy100)\\fad(50,120)}'
                        : '{\\alpha&HFF&\\t(0,150,\\alpha&H00&)\\fscx92\\fscy92\\t(0,220,\\fscx106\\fscy106)\\t(220,380,\\fscx100\\fscy100)}'
                } else if (config.animation === 'bounce') {
                    // Adaptive bounce: short text gets bigger oscillation, long text subtle
                    const isShort = displayText.length <= 30
                    animTag = isShort
                        ? '{\\fscx90\\fscy90\\t(0,160,\\fscx110\\fscy110)\\t(160,280,\\fscx95\\fscy95)\\t(280,370,\\fscx103\\fscy103)\\t(370,450,\\fscx100\\fscy100)\\fad(0,100)}'
                        : '{\\alpha&HFF&\\t(0,120,\\alpha&H00&)\\fscx94\\fscy94\\t(0,170,\\fscx106\\fscy106)\\t(170,290,\\fscx95\\fscy95)\\t(290,380,\\fscx102\\fscy102)\\t(380,460,\\fscx100\\fscy100)}'
                } else if (config.animation === 'slide_up') {
                    // Slide up: use \move for vertical motion
                    // Calculate center-x and y positions based on alignment
                    const cx = Math.round(config.playResX / 2)
                    const slideDistance = Math.round(50 * (config.playResY / config.previewHeight))
                    // For bottom alignment (al=2): text at bottom, slide from below
                    // For top (al=8): slide from above; for center (al=5): slide from below
                    const baseY = config.position === 'top'
                        ? Math.round(config.playResY * 0.10)
                        : config.position === 'center'
                            ? Math.round(config.playResY / 2)
                            : config.playResY - Math.round(60 * (config.playResY / config.previewHeight))
                    animTag = `{\\move(${cx},${baseY + slideDistance},${cx},${baseY},0,300)\\fad(250,150)}`
                } else if (config.animation === 'none') {
                    animTag = ''
                }

                // ── Neon glow: multi-layer technique (brighter) ──
                // Apply the SAME animation to each glow layer
                if (config.style === 'neon_glow') {
                    // Strip outer braces from animTag to embed inside glow tags
                    const animInner = animTag.replace(/^\{/, '').replace(/\}$/, '')
                    // LAYER 0 (background): ultra-wide faint glow
                    dialogues.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,{\\blur30\\bord0\\shad0\\1c&H00CCFF00&\\1a&H50&${animInner}}${displayText}`)
                    // LAYER 1: heavily blurred bright glow halo
                    dialogues.push(`Dialogue: 1,${start},${end},Default,,0,0,0,,{\\blur18\\bord0\\shad0\\1c&H00CCFF00&\\1a&H18&${animInner}}${displayText}`)
                    // LAYER 2: medium blur inner glow
                    dialogues.push(`Dialogue: 2,${start},${end},Default,,0,0,0,,{\\blur6\\bord3\\shad0\\1c&H00CCFF00&\\3c&H00CCFF00&${animInner}}${displayText}`)
                    // LAYER 3 (foreground): sharp crisp text
                    dialogues.push(`Dialogue: 3,${start},${end},Default,,0,0,0,,{\\blur0.4\\bord2\\shad0\\1c&H00CCFF00&\\3c&H00000000&${animInner}}${displayText}`)
                } else {
                    dialogues.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${animTag}${displayText}`)
                }
            }
        }
    }

    // ── Build style ──

    const scale = config.playResY / config.previewHeight
    const sz = Math.max(40, Math.round((config.fontSize || 22) * scale * 0.85))

    // Defaults — overridden per-style below
    let fn = 'Montserrat', bd = -1, pc = '&H00FFFFFF', oc = '&H00000000', bc = '&H80000000'
    let ol = 4, sh = 3, al = 2, sp = 0   // outline, shadow, alignment, spacing

    // Auto-detect CJK text → switch to CJK-compatible font
    const allText = config.segments.map(s => s.text).join(' ')
    const isCJK = hasCJK(allText)

    // Alignment
    if (config.position === 'top') al = 8
    else if (config.position === 'center') al = 5

    // Style-specific overrides (matched to old CSS preview styles)
    if (config.style === 'bold_center') { fn = 'Montserrat'; bd = -1; pc = '&H00FFFFFF'; oc = '&H00000000'; bc = '&H99000000'; ol = 5; sh = 3 }
    else if (config.style === 'karaoke') { fn = 'Poppins'; bd = -1; pc = '&H0000D7FF'; oc = '&H00000000'; bc = '&H64000000'; ol = 4; sh = 2 }
    else if (config.style === 'thin_minimal') { fn = 'Poppins'; bd = 0; pc = '&H0FF0FFFF'; oc = '&H00000000'; bc = '&H64000000'; ol = 3; sh = 1 }
    else if (config.style === 'neon_glow') { fn = 'Bangers'; bd = -1; pc = '&H00CCFF00'; oc = '&H00000000'; bc = '&H00000000'; ol = 5; sh = 0; sp = 2 }
    else if (config.style === 'dynamic_caption') { fn = 'Montserrat'; bd = -1; pc = '&H00FFFFFF'; oc = '&H00000000'; bc = '&H99000000'; ol = 5; sh = 4 }

    // Override font for CJK text
    if (isCJK) fn = CJK_FONT

    // Margins
    const cssBottomPx = 60
    const cssTopPct = 0.10
    let baseMarginV = Math.round(cssBottomPx * scale)
    if (config.position === 'top') baseMarginV = Math.round(cssTopPct * config.playResY)
    else if (config.position === 'center') baseMarginV = 0

    const offsetYScaled = Math.round((config.offsetY || 0) * scale)
    const offsetXScaled = Math.round((config.offsetX || 0) * scale)

    let mv = baseMarginV
    if (config.position === 'top') {
        mv = baseMarginV + offsetYScaled
    } else if (config.position === 'center') {
        mv = offsetYScaled
    } else {
        mv = baseMarginV - offsetYScaled
    }
    mv = Math.max(0, Math.min(config.playResY - 120, mv))

    let ml = 54 + Math.max(0, offsetXScaled)
    let mr = 54 + Math.max(0, -offsetXScaled)

    // Karaoke SecondaryColour
    let sc = '&H000000FF'
    if (config.animation === 'karaoke') {
        sc = pc.replace('&H00', '&H99')
    }

    // ── Assemble ASS ──

    const assContent = [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${config.playResX}`,
        `PlayResY: ${config.playResY}`,
        'WrapStyle: 0',
        'Collisions: Normal',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        `Style: Default,${fn},${sz},${pc},${sc},${oc},${bc},${bd},0,0,0,100,100,${sp},0,1,${ol},${sh},${al},${ml},${mr},${mv},1`,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...dialogues,
    ].join('\n')

    return assContent
}
