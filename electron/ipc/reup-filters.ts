/**
 * reup-filters.ts â€” FFmpeg filter chain builder for anti-detection pipeline.
 * Includes 16 filter layers + Frame Templates + Title + Logo + BG Blur.
 *
 * Architecture khi BG Blur báº­t:
 *   FG luÃ´n pad vá» full frame (RGBA transparent via black@0)
 *   â†’ táº¥t cáº£ filter dÃ¹ng fixed frame dimensions bÃ¬nh thÆ°á»ng
 *   BG = separate blurred copy: scale 1.3x cover â†’ gblur â†’ crop â†’ darken
 *   â†’ overlay FG (cÃ³ transparent pad) lÃªn BG
 */
import path from 'path'

export type ColorGradingStyle = 'none' | 'vibrant' | 'bw' | 'sepia' | 'cool_blue'

export interface ReupConfig {
    inputFolder: string
    singleFile?: string
    mirror: boolean
    crop: number
    cropX: number
    cropY: number
    noise: boolean | number
    rotate: boolean | number
    lensDistortion: boolean
    hdr: boolean
    speed: number
    pitchShift?: boolean
    audioEvade?: boolean
    cleanMetadata: boolean
    musicPath: string
    colorGrading: ColorGradingStyle
    glow: boolean
    volumeBoost: number
    srtPath?: string
    // Frame effects
    frameTemplate?: string
    borderWidth?: number
    borderColor?: string
    zoomEffect?: boolean
    zoomIntensity?: number
    // Pixel-level anti-detect (0=off, 100=max)
    pixelEnlarge?: number
    chromaShuffle?: number
    rgbDrift?: boolean
    // Advanced anti-detect (0=off, 100=max)
    frameJitter?: number
    gammaShift?: number
    microColorCycle?: number
    dctNoise?: number
    // Title overlay
    titleTemplate?: string
    titleText?: string
    descText?: string
    // Logo
    logoPath?: string
    logoPosition?: string
    logoSize?: number
    // Overlay (video/image overlay on top of export)
    overlayPath?: string
    overlayOpacity?: number       // 0-100
    overlayBlink?: boolean
    overlayBlinkSpeed?: number    // seconds per blink cycle
    overlayInterval?: number      // seconds between blinks
    // Reframe (scale X/Y/Z + position)
    reframeZoom?: number
    reframeScaleX?: number
    reframeScaleY?: number
    reframePosX?: number
    reframePosY?: number
    // Text styling
    textFont?: string
    titleFontSize?: number
    descFontSize?: number
    textColor?: string
    titleOffsetX?: number
    titleOffsetY?: number
    descOffsetX?: number
    descOffsetY?: number
    // Background blur
    bgBlur?: boolean
    bgBlurAmount?: number
    // Audio
    removeAudio?: boolean
    // Subtitle styling
    subStyle?: string
    subFontSize?: number
    subPosition?: string
    subAnimation?: string
    subOffsetX?: number
    subOffsetY?: number
    previewHeight?: number
    // Frame interleave
    interleaveEnabled?: boolean
    interleaveFolderPath?: string
    interleaveWarmup?: number     // seconds before first interleave
    interleaveRatio?: number      // ratio of interleaved frames (1-10)
    // Split
    splitEnabled?: boolean
    splitDuration?: number
    // Anti-detect arsenal (Auto Pipeline only)
    hueShift?: number
    microZoom?: number
    fadeInOut?: number
    ptsJitter?: boolean
    microTempo?: number
    deviceProfile?: string
    brightnessShift?: number
    contrastShift?: number
    saturationShift?: number
    vignette?: boolean
    colorTemp?: string
}

/**
 * Determine if FFmpeg pre-processing is needed before NVEncC.
 * NVEncC handles most filters via GLSL shaders, but some require FFmpeg:
 *   - Title text (drawtext) â€” GLSL can't render text
 *   - Frame Template with padding â€” NVEncC --output-res only resizes, doesn't pad
 *   - Colored border â€” NVEncC --vpp-pad doesn't support color
 *   - BG Blur compositing â€” requires filter_complex (split, overlay)
 *   - Speed change â€” setpts/atempo need FFmpeg
 * When true: FFmpeg handles the full pipeline (slower but complete).
 * When false: NVEncC handles via GPU shaders (3-5x faster).
 */
export function needsFFmpegPreProcess(config: ReupConfig): boolean {
    // Title text â†’ FFmpeg drawtext
    if (config.titleText || config.descText) return true
    if (config.titleTemplate && config.titleTemplate !== 'none') return true

    // Frame Template â†’ FFmpeg scale+pad
    if (config.frameTemplate && config.frameTemplate !== 'none') return true

    // Colored border â†’ FFmpeg pad
    if (config.borderWidth && config.borderWidth > 0) return true

    // BG Blur â†’ filter_complex composite
    if (config.bgBlur) return true

    // Speed change â†’ setpts+atempo
    if (config.speed !== 1.0) return true

    // Reframe â†’ complex scale+pad+crop
    const hasReframe = (config.reframeZoom ?? 100) !== 100 ||
        (config.reframeScaleX ?? 100) !== 100 ||
        (config.reframeScaleY ?? 100) !== 100 ||
        (config.reframePosX ?? 0) !== 0 ||
        (config.reframePosY ?? 0) !== 0
    if (hasReframe) return true

    // Everything else: NVEncC handles via GLSL shaders
    return false
}

/** Color grading FFmpeg filter strings â€” matched to CSS preview values.
 *  Contrast & saturation use EXACT CSS values (both are multiplicative).
 *  Brightness is slightly adjusted (CSS is multiplicative, FFmpeg eq is additive). */
export function getColorGradingFilter(style: ColorGradingStyle): string {
    switch (style) {
        // CSS: saturate(1.3) contrast(1.08) brightness(1.05)
        // BOOSTED: CSS compounds multiplicatively with HDR+glow â†’ need higher FFmpeg values
        case 'vibrant':
            return 'eq=brightness=0.06:contrast=1.12:saturation=1.45'
        // CSS: grayscale(1) contrast(1.15)
        case 'bw':
            return 'hue=s=0,eq=contrast=1.15'
        // CSS: sepia(0.6) saturate(1.2) brightness(1.05)
        case 'sepia':
            return [
                'colorchannelmixer=rr=0.58:rg=0.46:rb=0.11:gr=0.34:gg=0.41:gb=0.10:br=0.27:bg=0.32:bb=0.08',
                'eq=saturation=1.2:brightness=0.03',
            ].join(',')
        // CSS: saturate(0.85) hue-rotate(15deg) brightness(1.02)
        case 'cool_blue':
            return 'eq=saturation=0.85:brightness=0.01,hue=h=15'
        default:
            return ''
    }
}

/** Logo position â†’ FFmpeg overlay coordinates.
 *  'auto' = cycle through 4 corners every 3s (matching preview behavior).
 *  Uses eval=frame with time expressions â€” returned as full overlay options string.
 */
function getLogoOverlayPos(pos: string): string {
    const pad = 20
    if (pos === 'auto') {
        // Cycle: top-left(0) â†’ top-right(1) â†’ bottom-right(2) â†’ bottom-left(3) â†’ repeat
        const idx = `mod(floor(t/3)\\,4)`  // escaped comma for FFmpeg
        const xExpr = `${pad}+(W-w-${2 * pad})*gt(${idx}\\,0)*lt(${idx}\\,3)`
        const yExpr = `${pad}+(H-h-${2 * pad})*gte(${idx}\\,2)`
        return `x='${xExpr}':y='${yExpr}':eval=frame`
    }
    const map: Record<string, string> = {
        'top-left': `x=${pad}:y=${pad}`,
        'top-right': `x=W-w-${pad}:y=${pad}`,
        'bottom-left': `x=${pad}:y=H-h-${pad}`,
        'bottom-right': `x=W-w-${pad}:y=H-h-${pad}`,
    }
    return map[pos] || map['bottom-right']
}

/** Frame template â†’ FFmpeg scale + pad dimensions */
function getFrameDimensions(template: string): { w: number; h: number } | null {
    const map: Record<string, { w: number; h: number }> = {
        '9:16': { w: 1080, h: 1920 },
        '1:1': { w: 1080, h: 1080 },
        '4:3': { w: 1440, h: 1080 },
        '3:4': { w: 1080, h: 1440 },
        '16:9': { w: 1920, h: 1080 },
    }
    return map[template] || null
}

/**
 * Build FFmpeg filter chain from config.
 * Returns { vf, af, complexFilter, extraInputs }.
 *
 * Modes:
 * - Simple (-vf): no logo, no bgBlur
 * - Complex (-filter_complex): logo and/or bgBlur
 *
 * When bgBlur active:
 *   FG: format=rgba â†’ pad black@0 (transparent) â†’ all filters â†’ overlay on BG
 *   BG: scale 1.3x cover â†’ gblur â†’ crop â†’ darken
 */
export function buildFilterChain(config: ReupConfig): {
    vf: string
    af: string
    complexFilter: string
    extraInputs: string[]
    needsMapping: boolean
} {
    const vFilters: string[] = []
    const aFilters: string[] = []
    const extraInputs: string[] = []
    const hasLogo = !!(config.logoPath && config.logoPath.trim())
    const hasBgBlur = !!(config.bgBlur && config.frameTemplate && config.frameTemplate !== 'none')
    // When BG blur is active, pads must be transparent so blur layer shows through
    const padColor = hasBgBlur ? 'black@0' : 'black'

    // â”€â”€â”€ VIDEO FILTERS â”€â”€â”€

    // L1: Mirror
    if (config.mirror) vFilters.push('hflip')

    // L2: Smart Crop (crop edges + pad back = frame/border effect)
    // CropX = cut left+right edges. CropY = cut top+bottom edges.
    // Uses CROP (not scale) â†’ content keeps original proportions, only edge pixels removed.
    const sCropX = config.cropX > 0 ? config.cropX : config.crop
    const sCropY = config.cropY > 0 ? config.cropY : config.crop
    if (sCropX > 0 || sCropY > 0) {
        const keepX = (1 - 2 * (sCropX || 0)).toFixed(3)  // e.g. 0.80 for 10% each side
        const keepY = (1 - 2 * (sCropY || 0)).toFixed(3)
        const cx = (sCropX || 0).toFixed(3)
        const cy = (sCropY || 0).toFixed(3)
        // Step 1: crop = remove edge pixels (center remains at original scale)
        vFilters.push(`crop=trunc(iw*${keepX}/2)*2:trunc(ih*${keepY}/2)*2:iw*${cx}:ih*${cy}`)
        // Step 2: pad = add bars back to original frame size
        vFilters.push(`pad=ceil(iw/${keepX}/2)*2:ceil(ih/${keepY}/2)*2:(ow-iw)/2:(oh-ih)/2:color=black`)
        vFilters.push('setsar=1')
    }

    // L3: Noise/Grain
    if (config.noise) {
        const intensity = typeof config.noise === 'number' ? config.noise : 10
        vFilters.push(`noise=alls=${intensity}:allf=u`)
    }

    // NOTE: Rotate moved to AFTER glow/RGB drawbox (matches CSS: filter before transform)

    // L5: Lens Distortion â€” CSS: perspective(500px) rotateY(2deg)
    // Minimal pincushion to approximate slight inward pull
    if (config.lensDistortion) {
        vFilters.push('lenscorrection=cx=0.5:cy=0.5:k1=-0.003:k2=-0.001')
    }

    // MERGED COLOR EFFECTS: accumulate eq= into single pass
    // Prevents: HDR(1.15) * Glow(1.06) * Vibrant(1.12) = 1.37x contrast
    {
        let eqContrast = 1.0
        let eqBrightness = 0.0
        let eqSaturation = 1.0
        let needUnsharp = false
        let unsharpLevel = 0

        if (config.hdr) {
            eqContrast += 0.12
            eqSaturation += 0.15
            eqBrightness += 0.02
            needUnsharp = true
            unsharpLevel = Math.max(unsharpLevel, 1)
        }

        if (config.colorGrading !== 'none') {
            switch (config.colorGrading) {
                case 'vibrant':
                    eqContrast += 0.08
                    eqBrightness += 0.04
                    eqSaturation += 0.30
                    break
                case 'bw':
                    vFilters.push('hue=s=0')
                    eqContrast += 0.12
                    break
                case 'sepia':
                    vFilters.push('colorchannelmixer=rr=0.58:rg=0.46:rb=0.11:gr=0.34:gg=0.41:gb=0.10:br=0.27:bg=0.32:bb=0.08')
                    eqSaturation += 0.15
                    eqBrightness += 0.02
                    break
                case 'cool_blue':
                    eqSaturation -= 0.10
                    eqBrightness += 0.01
                    vFilters.push('hue=h=12')
                    break
            }
        }

        if (config.glow) {
            eqBrightness += 0.06
            eqContrast += 0.03
            vFilters.push('colorbalance=rm=0.06:gm=0.03:bm=-0.03')
            needUnsharp = true
            unsharpLevel = Math.max(unsharpLevel, 2)
        }

        // Pixel Enlarge — adds contrast + brightness
        if (config.pixelEnlarge && config.pixelEnlarge > 0) {
            eqContrast += 0.10 * (config.pixelEnlarge / 100)
            eqBrightness += 0.03 * (config.pixelEnlarge / 100)
        }

        // Chroma Shuffle — adds saturation
        if (config.chromaShuffle && config.chromaShuffle > 0) {
            eqSaturation += 0.20 * (config.chromaShuffle / 100)
        }

        const eqParts: string[] = []
        if (eqContrast !== 1.0) eqParts.push(`contrast=${eqContrast.toFixed(2)}`)
        if (eqBrightness !== 0.0) eqParts.push(`brightness=${eqBrightness.toFixed(2)}`)
        if (eqSaturation !== 1.0) eqParts.push(`saturation=${eqSaturation.toFixed(2)}`)
        if (eqParts.length > 0) {
            vFilters.push(`eq=${eqParts.join(':')}`)
        }

        if (needUnsharp) {
            if (unsharpLevel >= 2) {
                vFilters.push('unsharp=7:7:0.8:5:5:0.0')
            } else {
                vFilters.push('unsharp=5:5:0.4:3:3:0.0')
            }
        }
    }

    // Border â€” CSS: box-shadow: inset 0 0 0 Wpx COLOR (draws INSIDE frame)
    if (config.borderWidth && config.borderWidth > 0) {
        const bw = config.borderWidth
        const bc = config.borderColor || '#000000'
        vFilters.push(
            `drawbox=x=0:y=0:w=iw:h=${bw}:color=${bc}:t=fill`,         // top
            `drawbox=x=0:y=ih-${bw}:w=iw:h=${bw}:color=${bc}:t=fill`,  // bottom
            `drawbox=x=0:y=0:w=${bw}:h=ih:color=${bc}:t=fill`,         // left
            `drawbox=x=iw-${bw}:y=0:w=${bw}:h=ih:color=${bc}:t=fill`   // right
        )
    }

    // Frame dimension (used by frame template, zoom, reframe below)
    let frameDim: { w: number; h: number } | null = null

    // â”€â”€â”€ GLOW + RGB BORDER (on source frame edges, BEFORE rotate) â”€â”€â”€
    // CSS: filter (drop-shadow) applies BEFORE transform (rotate).

    // Glow/Bloom HALO  OPTIMIZED: 8 drawbox layers (2 tiers)
    if (config.glow) {
        vFilters.push(
            'drawbox=x=0:y=0:w=2:h=ih:color=0xFFC864@0.10:t=fill',
            'drawbox=x=iw-2:y=0:w=2:h=ih:color=0xFFC864@0.10:t=fill',
            'drawbox=x=0:y=0:w=iw:h=2:color=0xFFC864@0.10:t=fill',
            'drawbox=x=0:y=ih-2:w=iw:h=2:color=0xFFC864@0.10:t=fill'
        )
    }

    // RGB Drift BORDER — subtle colored edge (imperceptible to eye, changes fingerprint)
    if (config.rgbDrift) {
        vFilters.push(
            'drawbox=x=0:y=0:w=1:h=ih:color=0xFF4488@0.12:t=fill',
            'drawbox=x=iw-1:y=0:w=1:h=ih:color=0x44AAFF@0.12:t=fill',
            'drawbox=x=0:y=0:w=iw:h=1:color=0x44AAFF@0.12:t=fill',
            'drawbox=x=0:y=ih-1:w=iw:h=1:color=0xFF4488@0.12:t=fill'
        )
    }

    // Rotate â€” CSS: transform: rotate(Xdeg) with overflow:hidden
    // MUST be AFTER glow/RGB drawbox so borders rotate with video content.
    // SSAA: Scale up 2x â†’ rotate â†’ scale down (anti-aliased edges)
    if (config.rotate) {
        const deg = typeof config.rotate === 'number' ? config.rotate : 2
        const rad = (-deg * Math.PI / 180).toFixed(4)
        const needSSAA = config.glow || config.rgbDrift
        if (needSSAA) {
            vFilters.push('scale=iw*2:ih*2:flags=lanczos')
            vFilters.push(`rotate=${rad}:c=black@0:ow=iw:oh=ih`)
            vFilters.push('scale=iw/2:ih/2:flags=lanczos')
        } else {
            vFilters.push(`rotate=${rad}:c=black@0:ow=iw:oh=ih`)
        }
    }

    // Frame Template (aspect ratio conversion)
    if (config.frameTemplate && config.frameTemplate !== 'none') {
        frameDim = getFrameDimensions(config.frameTemplate)
        if (frameDim) {
            // When BG blur active: RGBA format so pad creates transparent areas
            if (hasBgBlur) vFilters.push('format=rgba')
            vFilters.push(
                `scale=${frameDim.w}:${frameDim.h}:force_original_aspect_ratio=decrease:flags=lanczos`,
                `pad=${frameDim.w}:${frameDim.h}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`,
                'setsar=1'
            )
        }
    }

    // Reframe (X/Y/Z scale + position) â€” CSS: transform: scale(sx, sy) translate(px, py)
    // Runs BEFORE zoom â†’ CSS multiplies reframe*zoom on video element
    const rfZoom = config.reframeZoom ?? 100
    const rfSX = config.reframeScaleX ?? 100
    const rfSY = config.reframeScaleY ?? 100
    const rfPX = config.reframePosX ?? 0
    const rfPY = config.reframePosY ?? 0
    const hasReframe = rfZoom !== 100 || rfSX !== 100 || rfSY !== 100 || rfPX !== 0 || rfPY !== 0

    if (hasReframe) {
        const totalSX = (rfZoom / 100) * (rfSX / 100)
        const totalSY = (rfZoom / 100) * (rfSY / 100)
        const fw = frameDim ? frameDim.w : 1920
        const fh = frameDim ? frameDim.h : 1080

        const scaledW = Math.round(fw * totalSX / 2) * 2
        const scaledH = Math.round(fh * totalSY / 2) * 2

        vFilters.push(`scale=${scaledW}:${scaledH}:flags=lanczos`)

        const needPadW = scaledW < fw
        const needPadH = scaledH < fh
        if (needPadW || needPadH) {
            const pw = Math.max(scaledW, fw)
            const ph = Math.max(scaledH, fh)
            const px = needPadW ? Math.max(0, Math.round((fw - scaledW) / 2 + rfPX)) : 0
            const py = needPadH ? Math.max(0, Math.round((fh - scaledH) / 2 + rfPY)) : 0
            vFilters.push(`pad=${pw}:${ph}:${px}:${py}:color=${padColor}`)
        }

        const needCropW = scaledW > fw
        const needCropH = scaledH > fh
        if (needCropW || needCropH) {
            const cx = needCropW ? Math.max(0, Math.round((scaledW - fw) / 2 - rfPX)) : 0
            const cy = needCropH ? Math.max(0, Math.round((scaledH - fh) / 2 - rfPY)) : 0
            vFilters.push(`crop=${fw}:${fh}:${cx}:${cy}`)
        }

        vFilters.push('setsar=1')
    }

    // Zoom Effect â€” CSS-equivalent: scale UP + center crop (NOT zoompan)
    // MUST run AFTER reframe! CSS multiplies reframe*zoom on the video element.
    // Cycle: abs(sin(t*PI/16)) â†’ peaks at t=8s, returns at t=16s = CSS 8s alternate
    if (config.zoomEffect && config.zoomIntensity && config.zoomIntensity > 1.0) {
        // Bake microZoom into the animation base to avoid double-resampling later
        const baseZ = config.microZoom && config.microZoom > 1.0 ? config.microZoom : 1.0;
        const targetZ = baseZ * config.zoomIntensity;
        const amp = (targetZ - baseZ).toFixed(4);
        const baseExpr = baseZ.toFixed(4);
        
        const zoomW = frameDim ? frameDim.w : 1920
        const zoomH = frameDim ? frameDim.h : 1080
        // S-curve matches CSS 'ease-in-out' exactly
        const zoomExpr = `${baseExpr}+${amp}*0.5*(1-cos(t*PI/8))`
        vFilters.push(
            `scale=w='trunc(iw*(${zoomExpr})/2)*2':h='trunc(ih*(${zoomExpr})/2)*2':flags=lanczos:eval=frame`,
            `crop=${zoomW}:${zoomH}:(trunc(${zoomW}*(${zoomExpr})/2)*2-${zoomW})/2:(trunc(${zoomH}*(${zoomExpr})/2)*2-${zoomH})/2`,
            'setsar=1'
        )
    }

    // Title Text overlay (drawtext)
    const hasTitle = config.titleText && config.titleText.trim()
    const hasDesc = config.descText && config.descText.trim()
    if ((config.titleTemplate && config.titleTemplate !== 'none') || hasTitle || hasDesc) {
        const esc = (t: string) => t
            .replace(/\\/g, '/')
            .replace(/:/g, '\\:')
            .replace(/'/g, "\\'")
            .replace(/,/g, '\\,')
            .replace(/%/g, '%%')

        const appRoot = process.env.APP_ROOT || '.'
        const bundledForDrawtext = (filename: string) =>
            path.join(appRoot, 'fonts', filename).replace(/\\/g, '/').replace(/:/g, '\\:')

        const fontMap: Record<string, string> = {
            'Dancing Script': bundledForDrawtext('DancingScript-Bold.ttf'),
            'Pacifico': bundledForDrawtext('Pacifico-Regular.ttf'),
            'Lobster': bundledForDrawtext('Lobster-Regular.ttf'),
            'Sigmar One': bundledForDrawtext('SigmarOne-Regular.ttf'),
            'Bungee Shade': bundledForDrawtext('BungeeShade-Regular.ttf'),
            'Patrick Hand': bundledForDrawtext('PatrickHand-Regular.ttf'),
            'Dela Gothic One': bundledForDrawtext('DelaGothicOne-Regular.ttf'),
            'Fugaz One': bundledForDrawtext('FugazOne-Regular.ttf'),
            'Luckiest Guy': 'C\\:/Windows/Fonts/impact.ttf',
            'Bangers': bundledForDrawtext('Bangers-Regular.ttf'),
            'Inter': bundledForDrawtext('Inter-Bold.ttf'),
            'Arial': 'C\\:/Windows/Fonts/arialbd.ttf',
            'Impact': 'C\\:/Windows/Fonts/impact.ttf',
        }
        const userFont = config.textFont || 'Inter'
        let fontPath = fontMap[userFont] || bundledForDrawtext('Inter-Bold.ttf')

        // Vietnamese character fallback
        const hasVietnamese = /[\u00C0-\u024F\u1E00-\u1EFF]/.test(
            (config.titleText || '') + (config.descText || '')
        )
        const vietFonts = new Set([
            'Inter', 'Dancing Script', 'Patrick Hand',
            'Pacifico', 'Lobster', 'Bangers',
            'Dela Gothic One',
        ])
        if (hasVietnamese && !vietFonts.has(userFont)) {
            fontPath = bundledForDrawtext('Inter-Bold.ttf')
        }


        // Scale: preview container â†’ output frame
        const frameW = frameDim ? frameDim.w : 1920
        const frameH = frameDim ? frameDim.h : 1080
        const pvMaxW = 480, pvMaxH = 420
        const pvScale = Math.min(pvMaxW / frameW, pvMaxH / frameH)
        const pvWidth = frameW * pvScale
        const previewScale = frameW / pvWidth
        const titleSize = Math.round((config.titleFontSize || 24) * previewScale)
        const descSize = Math.round((config.descFontSize || 14) * previewScale)

        const fontcolor = config.textColor || '#ffffff'

        // Word-wrap with dynamic char width
        const titleCharWidth = titleSize * 0.55
        const titleMaxChars = Math.max(10, Math.floor((frameW * 0.80) / titleCharWidth))
        const descCharWidth = descSize * 0.55
        const descMaxChars = Math.max(10, Math.floor((frameW * 0.70) / descCharWidth))

        const wrapText = (text: string, maxChars: number): string[] => {
            const words = text.split(/\s+/)
            const lines: string[] = []
            let current = ''
            for (const word of words) {
                if ((current + ' ' + word).trim().length > maxChars && current) {
                    lines.push(current.trim())
                    current = word
                } else {
                    current = current ? current + ' ' + word : word
                }
            }
            if (current.trim()) lines.push(current.trim())
            return lines
        }

        const titleOX = Math.round((config.titleOffsetX || 0) * previewScale)
        const titleOY = Math.round((config.titleOffsetY || 0) * previewScale)
        const descOX = Math.round((config.descOffsetX || 0) * previewScale)
        const descOY = Math.round((config.descOffsetY || 0) * previewScale)

        if (config.titleText) {
            const lines = wrapText(config.titleText, titleMaxChars)
            const lineH = Math.round(titleSize * 1.3)
            const totalH = lines.length * lineH
            const centerY = Math.round(frameH / 2 + titleOY)
            const startY = Math.max(10, centerY - Math.round(totalH / 2))
            lines.forEach((line, i) => {
                const yPos = startY + i * lineH
                vFilters.push(
                    `drawtext=fontfile='${fontPath}':text='${esc(line)}':x=(w-text_w)/2+${titleOX}:y=${yPos}:fontsize=${titleSize}:fontcolor=${fontcolor}:borderw=5:bordercolor=black:shadowx=2:shadowy=2:shadowcolor=black@0.6`
                )
            })
        }
        if (config.descText) {
            const lines = wrapText(config.descText, descMaxChars)
            const lineH = Math.round(descSize * 1.3)
            const totalH = lines.length * lineH
            const bottomPad = Math.round(40 * previewScale)
            const lastLineBottom = Math.min(frameH - 20, frameH - bottomPad + descOY)
            const startY = lastLineBottom - totalH
            lines.forEach((line, i) => {
                const yPos = Math.max(10, startY + i * lineH)
                vFilters.push(
                    `drawtext=fontfile='${fontPath}':text='${esc(line)}':x=(w-text_w)/2+${descOX}:y=${yPos}:fontsize=${descSize}:fontcolor=${fontcolor}:borderw=4:bordercolor=black:shadowx=1:shadowy=1:shadowcolor=black@0.5`
                )
            })
        }
    }

    // NOTE: Subtitles are NOT burned here (per-chunk vFilters).
    // They are applied as a post-concat pass in fastExport (reup.ipc.ts)
    // Reason: fastExport splits video into 30s chunks with PTS restart.
    // ASS/SRT timestamps are absolute, so they only match chunk 0.

    // â”€â”€â”€ PIXEL-LEVEL ANTI-DETECT â”€â”€â”€

    // Pixel Enlarge â€” CSS: image-rendering:pixelated + contrast(1.12) brightness(1.04)
    if (config.pixelEnlarge && config.pixelEnlarge > 0) {
        const enlScale = Math.max(2, Math.round(5 * config.pixelEnlarge / 100))
        vFilters.push(`scale=iw*${enlScale}:ih*${enlScale}:flags=neighbor`)
        vFilters.push(`scale=iw/${enlScale}:ih/${enlScale}:flags=neighbor`)
    }

    // Chroma Shuffle â€” CSS: hue-rotate(12deg) saturate(1.25)
    if (config.chromaShuffle && config.chromaShuffle > 0) {
        const hueDeg = Math.round(30 * config.chromaShuffle / 100)
        vFilters.push(`hue=h=${hueDeg}`)
    }

    // RGB Drift â€” pixel-level channel shift
    if (config.rgbDrift) {
        vFilters.push('rgbashift=rh=-3:rv=1:bh=3:bv=-1')
    }

    // ─── ANTI-DETECT ARSENAL ───

    // Subtle Hue Shift — rotate all colors 1-3° (imperceptible, changes every pixel hash)
    if (config.hueShift && config.hueShift > 0) {
        vFilters.push(`hue=h=${config.hueShift}`)
    }

    // Micro Zoom — scale up slightly + crop back (changes spatial matrix, defeats pHash)
    // If zoomEffect is ON, microZoom was already baked into the Ken Burns animation!
    if (!config.zoomEffect && config.microZoom && config.microZoom > 1.0) {
        const z = config.microZoom.toFixed(3)
        vFilters.push(`scale=trunc(iw*${z}/2)*2:trunc(ih*${z}/2)*2:flags=lanczos`)
        vFilters.push(`crop=trunc(iw/${z}/2)*2:trunc(ih/${z}/2)*2`)
        vFilters.push('setsar=1')
    }

    // PTS Timestamp Jitter — ±2ms per frame (temporal fingerprint evasion)
    if (config.ptsJitter) {
        vFilters.push('setpts=PTS+random(0)*0.002')
    }

    // Random Brightness/Contrast — ±2% shift (imperceptible, changes pixel values)
    if (config.brightnessShift) {
        const b = config.brightnessShift  // e.g. 0.02 or -0.02
        const c = config.contrastShift || 1.0  // e.g. 1.02 or 0.98
        vFilters.push(`eq=brightness=${b.toFixed(3)}:contrast=${c.toFixed(3)}`)
    }

    // Saturation Shift — ±5% (subtle color vibrancy change)
    if (config.saturationShift && config.saturationShift !== 1.0) {
        vFilters.push(`hue=s=${config.saturationShift.toFixed(2)}`)
    }

    // Vignette — subtle darkening of corners (cinematic look)
    if (config.vignette) {
        vFilters.push(`vignette=PI/5`)
    }

    // Color Temperature — warm/cool shift via colorbalance
    if (config.colorTemp && config.colorTemp !== 'none') {
        if (config.colorTemp === 'warm') {
            vFilters.push('colorbalance=rs=0.03:gs=-0.01:bs=-0.03')
        } else if (config.colorTemp === 'cool') {
            vFilters.push('colorbalance=rs=-0.03:gs=0.01:bs=0.03')
        }
    }

    // Fade In — subtle fade defeats opening frame fingerprint
    if (config.fadeInOut && config.fadeInOut > 0) {
        vFilters.push(`fade=t=in:st=0:d=${config.fadeInOut.toFixed(2)}`)
    }

    // Always ensure yuv420p â€” BUT skip when BG blur is active!
    // BG blur needs RGBA alpha channel for overlay transparency (black@0 pads).
    if (!hasBgBlur) {
        vFilters.push('format=yuv420p')
    }

    // â”€â”€â”€ AUDIO FILTERS â”€â”€â”€

    // Speed Change — MOVED to post-concat pass in reup.ipc.ts
    // Per-chunk speed causes PTS drift at concat boundaries → subtitle desync
    // if (config.speed !== 1.0) {
    //     vFilters.push(`setpts=PTS/${config.speed.toFixed(3)}`)
    //     aFilters.push(`atempo=${config.speed.toFixed(3)}`)
    // }

    // Micro Tempo — imperceptible speed shift defeats audio spectrogram matching
    if (config.microTempo && config.microTempo !== 1.0) {
        aFilters.push(`atempo=${config.microTempo.toFixed(4)}`)
    }

    // Audio Evade â€” comprehensive audio fingerprint evasion
    if (config.audioEvade || config.pitchShift) {
        aFilters.push('asetrate=44100*1.03,aresample=44100')
        aFilters.push('channelmap=1|0')
        aFilters.push('equalizer=f=100:width_type=o:width=2:g=3')
        aFilters.push('aecho=0.8:0.88:6:0.4')
    }

    // Volume boost
    if (config.volumeBoost && config.volumeBoost !== 1.0) {
        aFilters.push(`volume=${config.volumeBoost.toFixed(1)}`)
    }

    // â”€â”€â”€ BUILD FINAL FILTER â”€â”€â”€

    const vfStr = vFilters.join(',')
    let complexFilter = ''

    const fDim = getFrameDimensions(config.frameTemplate || '9:16')
    const fW = fDim ? fDim.w : 1080
    const fH = fDim ? fDim.h : 1920

    if (hasBgBlur || hasLogo) {
        let chain = ''
        let lastLabel = 'base'

        // Step 1: Process foreground video with all filters
        chain += `[0:v]${vfStr}[base]`

        // Step 2: BG blur layer
        // CSS: filter: blur(40px) brightness(0.45) saturate(1.2); transform: scale(1.3)
        // FFmpeg: scale to cover 1.3x frame â†’ gblur â†’ crop â†’ darken
        if (hasBgBlur) {
            const blurSigma = Math.round((config.bgBlurAmount || 40) / 2)
            const bgScaleW = Math.round(fW * 1.3 / 2) * 2
            const bgScaleH = Math.round(fH * 1.3 / 2) * 2
            chain += `;[0:v]scale=${bgScaleW}:${bgScaleH}:force_original_aspect_ratio=increase:flags=fast_bilinear`
            chain += `,gblur=sigma=${blurSigma}`
            chain += `,crop=${fW}:${fH}`
            chain += `,eq=brightness=-0.35:saturation=1.2`
            chain += `[bg]`
            const bgOutLabel = hasLogo ? 'composed' : 'v'
            chain += `;[bg][base]overlay=(W-w)/2:(H-h)/2:format=auto[${bgOutLabel}]`
            lastLabel = bgOutLabel
        }

        // Step 3: Logo overlay on top
        if (hasLogo) {
            extraInputs.push(config.logoPath!)
            const pct = (config.logoSize || 12) / 100
            const pos = getLogoOverlayPos(config.logoPosition || 'bottom-right')
            const logoW = Math.round(fW * pct)
            const logoInputIdx = 1
            chain += `;[${logoInputIdx}:v]scale=${logoW}:-1:flags=lanczos,format=rgba[logo]`
            chain += `;[${lastLabel}][logo]overlay=${pos}[v]`
            lastLabel = 'v'
        }

        complexFilter = chain
    }

    const needsMap = hasBgBlur || hasLogo

    return {
        vf: needsMap ? '' : vfStr,
        af: aFilters.length > 0 ? aFilters.join(',') : '',
        complexFilter,
        extraInputs,
        needsMapping: needsMap,
    }
}

/**
 * Build Hâ†’V filter chain (landscape â†’ portrait 1080x1920).
 */
export function buildHtoVFilter(): string {
    return 'scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1'
}
