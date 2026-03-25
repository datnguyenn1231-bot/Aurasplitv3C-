/**
 * nvenc-builder.ts — NVEncC64 command builder with libplacebo GPU shaders.
 *
 * Architecture:
 *   NVEncC --avhw (GPU decode)
 *     → --vpp-libplacebo-shader (GPU filter chain via GLSL)
 *     → --vpp-transform / --vpp-overlay / --vpp-subburn (built-in VPP)
 *     → NVEncC H.264 encode (GPU)
 *
 * Result: Full GPU pipeline = 10-15x faster than FFmpeg CPU filters.
 */
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import type { ReupConfig } from './reup-filters.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Detect the video codec of an input file using ffprobe.
 * Returns 'hevc' for H.265, 'h264' for H.264, or the raw codec name.
 */
export function detectInputCodec(inputPath: string): string {
    try {
        // Try bundled ffprobe first, then system
        const root = getResourcesRoot()
        const ffprobes = [
            path.join(root, 'binaries', 'ffprobe.exe'),
            'ffprobe',
        ]
        let ffprobe = 'ffprobe'
        for (const p of ffprobes) {
            if (p === 'ffprobe' || fs.existsSync(p)) { ffprobe = p; break }
        }
        const output = execSync(
            `"${ffprobe}" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${inputPath}"`,
            { timeout: 10000, encoding: 'utf-8', windowsHide: true }
        ).trim()

        return output.toLowerCase()
    } catch (e) {

        return 'h264'
    }
}

function getResourcesRoot(): string {
    if (app.isPackaged) return process.resourcesPath
    return path.resolve(__dirname, '..')
}

/** Get path to bundled NVEncC64.exe */
export function getNVEncCPath(): string {
    const root = getResourcesRoot()
    const local = path.join(root, 'binaries', 'NVEncC64.exe')
    if (fs.existsSync(local)) return local
    return '' // not available
}

/** Get path to shaders directory */
function getShadersDir(): string {
    const root = getResourcesRoot()
    // During dev: electron/../shaders
    // When packaged: resources/shaders
    const devPath = path.resolve(root, '..', 'shaders')
    const prodPath = path.join(root, 'shaders')
    if (fs.existsSync(devPath)) return devPath
    if (fs.existsSync(prodPath)) return prodPath
    return devPath // fallback
}

/** Check if NVEncC64 is available */
export function isNVEncCAvailable(): boolean {
    return !!getNVEncCPath()
}

/**
 * Check if NVEncC can handle this config.
 * NVEncC supports: mirror, crop, noise, rotate, lens, HDR, color grading,
 *   glow, pixel enlarge, RGB drift, chroma shuffle, zoom, subtitles, logo, metadata.
 * NVEncC KHÔNG hỗ trợ:
 *   - Title text overlay (drawtext) — cần FFmpeg
 *   - Frame Template với padding (--output-res chỉ resize, KHÔNG pad black bars)
 *   - Colored border (--vpp-pad không hỗ trợ color)
 *   - Speed change (setpts/atempo) — cần FFmpeg post-process
 *   - BG Blur (filter_complex composite) — cần FFmpeg
 *   - Reframe (complex scale+pad+crop) — cần FFmpeg
 *   - Overlay/Interleave — cần FFmpeg post-process
 */
export function canUseNVEncC(config: ReupConfig): boolean {
    // Title text → FFmpeg drawtext (NVEncC không có text rendering)
    if (config.titleTemplate && config.titleTemplate !== 'none') return false
    if (config.titleText || config.descText) return false

    // Frame Template → FFmpeg scale+pad (NVEncC --output-res chỉ resize, không pad)
    if (config.frameTemplate && config.frameTemplate !== 'none') return false

    // Colored border → FFmpeg drawbox filter
    if (config.borderWidth && config.borderWidth > 0) return false

    // BG Blur → FFmpeg filter_complex composite (split→blur→overlay)
    if (config.bgBlur) return false

    // Speed change → FFmpeg setpts/atempo
    if (config.speed && config.speed !== 1.0) return false

    // Reframe → FFmpeg complex scale+pad+crop
    const hasReframe = (config.reframeZoom ?? 100) !== 100 ||
        (config.reframeScaleX ?? 100) !== 100 ||
        (config.reframeScaleY ?? 100) !== 100 ||
        (config.reframePosX ?? 0) !== 0 ||
        (config.reframePosY ?? 0) !== 0
    if (hasReframe) return false

    // Tất cả filter còn lại NVEncC xử lý được qua libplacebo shaders
    return true
}

/**
 * Check if speed post-processing is needed.
 * Khi speed ≠ 1.0, sau NVEncC render → FFmpeg setpts + atempo (rất nhanh với NVENC)
 */
export function needsSpeedPostProcess(config: ReupConfig): boolean {
    return config.speed !== 1.0
}

/**
 * Check if the config requires separate audio processing.
 * When true, the caller must extract+process audio via FFmpeg separately.
 */
export function needsSeparateAudio(config: ReupConfig): boolean {
    return !!(
        (config.volumeBoost && config.volumeBoost !== 1.0) ||
        config.audioEvade ||
        config.pitchShift ||
        (config.microTempo && config.microTempo !== 1.0)
    )
}

// ─── Dynamic Shader Generation ───
// Some shaders need runtime parameters (noise intensity, rotation angle, etc.)
// We generate temp .glsl files with hardcoded values.

const TEMP_SHADER_DIR = path.join(
    process.env.TEMP || process.env.TMP || '/tmp',
    'aurasplit_shaders'
)

function ensureTempShaderDir(): void {
    if (!fs.existsSync(TEMP_SHADER_DIR)) {
        fs.mkdirSync(TEMP_SHADER_DIR, { recursive: true })
    }
}

function writeTempShader(name: string, content: string): string {
    ensureTempShaderDir()
    const p = path.join(TEMP_SHADER_DIR, name)
    fs.writeFileSync(p, content, 'utf-8')
    return p
}

/** Generate noise shader with configurable intensity */
function generateNoiseShader(intensity: number): string {
    // intensity = FFmpeg noise alls value (default 10, range 0-100)
    const normalized = (intensity / 255).toFixed(4)
    return `//!HOOK RGB
//!BIND HOOKED
//!DESC Add film grain noise (intensity=${intensity})
vec4 hook() {
    vec4 color = HOOKED_texOff(0);
    vec2 pos = gl_FragCoord.xy;
    float seed = random + dot(pos, vec2(12.9898, 78.233));
    float noise = fract(sin(seed) * 43758.5453) - 0.5;
    color.rgb += vec3(noise * ${normalized});
    return clamp(color, 0.0, 1.0);
}`
}

/** Generate rotation shader with configurable angle */
function generateRotateShader(degrees: number): string {
    const rad = (degrees * Math.PI / 180).toFixed(6)
    return `//!HOOK RGB
//!BIND HOOKED
//!DESC Subtle rotation (${degrees}°)
vec4 hook() {
    float angle = ${rad};
    vec2 center = input_size * 0.5;
    vec2 pos = gl_FragCoord.xy - center;
    float c = cos(angle), s = sin(angle);
    vec2 rotated = vec2(pos.x*c - pos.y*s, pos.x*s + pos.y*c);
    vec2 uv = (rotated + center) / input_size;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        return vec4(0.0, 0.0, 0.0, 1.0);
    return HOOKED_tex(uv);
}`
}

/** Generate zoompan shader with configurable max zoom */
function generateZoompanShader(maxZoom: number): string {
    return `//!HOOK RGB
//!BIND HOOKED
//!DESC Slow zoom-in (Ken Burns, maxZoom=${maxZoom.toFixed(3)})
vec4 hook() {
    float maxZ = ${maxZoom.toFixed(3)};
    float zoom = min(1.0 + float(frame) * 0.0005, maxZ);
    vec2 center = vec2(0.5);
    vec2 uv = gl_FragCoord.xy / input_size;
    vec2 zoomed = (uv - center) / zoom + center;
    if (zoomed.x < 0.0 || zoomed.x > 1.0 || zoomed.y < 0.0 || zoomed.y > 1.0)
        return vec4(0.0, 0.0, 0.0, 1.0);
    return HOOKED_tex(zoomed);
}`
}

/**
 * Build NVEncC64 command args from config.
 * Uses libplacebo GLSL shaders for all pixel-level filters.
 */
export function buildNVEncCArgs(
    config: ReupConfig,
    inputPath: string,
    outputPath: string,
    useY4mPipe: boolean = false,
    inputCodec: string = 'h264'
): string[] {
    const args: string[] = []
    const shaderDir = getShadersDir()

    // ─── Input ───
    if (useY4mPipe) {
        args.push('--y4m', '-i', '-')
    } else {
        // H.265/HEVC: use --avsw (software decode) to avoid frame freezing on some GPUs
        // H.264: use --avhw (hardware decode) for maximum speed
        const isHevc = inputCodec === 'hevc' || inputCodec === 'h265'
        if (isHevc) {

            args.push('--avsw', '-i', inputPath)
        } else {
            args.push('--avhw', '-i', inputPath)
        }
    }

    // ─── Output ───
    args.push('-o', outputPath)
    args.push('--codec', 'h264', '--preset', 'p1', '--cqp', '23')

    // ─── LIBPLACEBO SHADER CHAIN ───
    // Order matters: applied sequentially on GPU

    // L1: Mirror (built-in VPP — faster than shader)
    if (config.mirror) {
        args.push('--vpp-transform', 'flip_x=true')
    }

    // L2: Smart Crop → --crop (needs pixel values)
    if (config.crop > 0) {
        // NVEncC --crop expects left,top,right,bottom in pixels
        // We'll estimate from percentage — actual resolution is needed
        // For now, use --crop with approximate values based on 1080p
        // This will be refined when we know actual resolution
        const cropPx = Math.round(1920 * config.crop / 2)
        const cropPxH = Math.round(1080 * config.crop / 2)
        args.push('--crop', `${cropPx},${cropPxH},${cropPx},${cropPxH}`)
    }

    // L3: Noise/Grain → dynamic shader
    if (config.noise) {
        const intensity = typeof config.noise === 'number' ? config.noise : 10
        const shaderPath = writeTempShader('noise.glsl', generateNoiseShader(intensity))
        args.push('--vpp-libplacebo-shader', `shader=${shaderPath}`)
    }

    // L4: Rotation → dynamic shader
    if (config.rotate) {
        const deg = typeof config.rotate === 'number' ? config.rotate : 2
        const shaderPath = writeTempShader('rotate.glsl', generateRotateShader(deg))
        args.push('--vpp-libplacebo-shader', `shader=${shaderPath}`)
    }

    // L5: Lens Distortion → static shader
    if (config.lensDistortion) {
        args.push('--vpp-libplacebo-shader', `shader=${path.join(shaderDir, 'lens.glsl')}`)
    }

    // L6: HDR → static shader (eq + unsharp combined)
    if (config.hdr) {
        args.push('--vpp-libplacebo-shader', `shader=${path.join(shaderDir, 'hdr.glsl')}`)
    }

    // Color Grading → preset shaders
    if (config.colorGrading && config.colorGrading !== 'none') {
        const cgMap: Record<string, string> = {
            'vibrant': 'color_vibrant.glsl',
            'bw': 'color_bw.glsl',
            'sepia': 'color_sepia.glsl',
            'cool_blue': 'color_coolblue.glsl',
        }
        const shaderFile = cgMap[config.colorGrading]
        if (shaderFile) {
            args.push('--vpp-libplacebo-shader', `shader=${path.join(shaderDir, shaderFile)}`)
        }
    }

    // Glow/Bloom → static shader
    if (config.glow) {
        args.push('--vpp-libplacebo-shader', `shader=${path.join(shaderDir, 'glow.glsl')}`)
    }

    // Pixel Enlarge → static shader
    if (config.pixelEnlarge) {
        args.push('--vpp-libplacebo-shader', `shader=${path.join(shaderDir, 'pixelate.glsl')}`)
    }

    // RGB Drift → static shader
    if (config.rgbDrift) {
        args.push('--vpp-libplacebo-shader', `shader=${path.join(shaderDir, 'rgbdrift.glsl')}`)
    }

    // ChromaShuffle → static shader
    if (config.chromaShuffle) {
        args.push('--vpp-libplacebo-shader', `shader=${path.join(shaderDir, 'chromashuffle.glsl')}`)
    }

    // Zoom Effect (Ken Burns) → dynamic shader
    if (config.zoomEffect && config.zoomIntensity && config.zoomIntensity > 1.0) {
        const shaderPath = writeTempShader('zoompan.glsl', generateZoompanShader(config.zoomIntensity))
        args.push('--vpp-libplacebo-shader', `shader=${shaderPath}`)
    }

    // ─── BUILT-IN VPP (non-shader) ───

    // Border → --vpp-pad (after shaders)
    if (config.borderWidth && config.borderWidth > 0) {
        const bw = config.borderWidth
        args.push('--vpp-pad', `${bw},${bw},${bw},${bw}`)
    }

    // Frame Template → --output-res
    if (config.frameTemplate && config.frameTemplate !== 'none') {
        const ratioMap: Record<string, string> = {
            '9:16': '1080x1920',
            '1:1': '1080x1080',
            '4:3': '1440x1080',
            '3:4': '1080x1440',
            '16:9': '1920x1080',
        }
        const res = ratioMap[config.frameTemplate]
        if (res) {
            args.push('--output-res', res)
        }
    }

    // Subtitle burn-in → --vpp-subburn
    if (config.srtPath) {
        args.push('--vpp-subburn', `filename="${config.srtPath}"`)
    }

    // Logo overlay → --vpp-overlay
    if (config.logoPath && config.logoPath.trim()) {
        const pos = config.logoPosition || 'bottom-right'
        let overlayArgs = `file="${config.logoPath}"`
        const logoSize = config.logoSize || 100
        overlayArgs += `,size=${logoSize}x${logoSize}`
        // Position for 1080p. top-left is the only fully static one.
        if (pos === 'top-left') overlayArgs += ',pos=20x20'
        args.push('--vpp-overlay', overlayArgs)
    }

    // Clean metadata
    if (config.cleanMetadata) {
        args.push('--no-metadata')
    }

    // ─── AUDIO ───
    if (!needsSeparateAudio(config)) {
        // Copy audio as-is when no audio effects needed
        args.push('--audio-copy')
        // Note: when needsSeparateAudio is true, we simply omit --audio-copy
        // NVEncC drops audio by default, caller will process audio separately
    }

    args.push('--log-level', 'warn')

    return args
}

/**
 * Build FFmpeg args for pipe mode (FFmpeg decode → Y4M pipe → NVEncC).
 * Used when --avhw is not available or for specific input formats.
 */
export function buildFFmpegPipeArgs(inputPath: string): string[] {
    return [
        '-y',
        '-i', inputPath,
        '-f', 'yuv4mpegpipe',
        '-pix_fmt', 'yuv420p',
        'pipe:1',
    ]
}
