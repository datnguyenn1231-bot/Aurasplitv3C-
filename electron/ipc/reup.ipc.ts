/**
 * Reup IPC â€” Video processing with 9-layer anti-detection pipeline.
 * Filter chain logic is in reup-filters.ts (separated for testability).
 */

import { spawn, execSync, ChildProcess } from 'child_process'
import { ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'

import { getFFmpegPath, getFFprobePath } from './ffmpeg.ipc.js'
import { buildFilterChain, type ReupConfig, type ColorGradingStyle } from './reup-filters.js'
import { getNVEncCPath, isNVEncCAvailable, canUseNVEncC, buildNVEncCArgs, needsSeparateAudio, needsSpeedPostProcess, detectInputCodec } from './nvenc-builder.js'
import { parseSrt, generateAssString, type SubStyle, type SubAnimation, type SubPosition } from '../../shared/assGenerator.js'
import { isClean } from '../security/integrity.js'

// Ghost verify (Layer 4)
let _rv = true
setTimeout(() => {
    _rv = isClean()
    try {
        const fs = require('node:fs')
        const p = require('node:path')
        const cachePath = p.join(require('electron').app.getPath('userData'), '.lc')
        if (!fs.existsSync(cachePath)) _rv = false
    } catch { _rv = false }
}, 12000 + Math.random() * 8000)

// â”€â”€ Constants â”€â”€
const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']

// â”€â”€ State â”€â”€
let activeProcs: ChildProcess[] = []
let stopped = false

// â”€â”€ GPU Detection â”€â”€
let _nvencAvailable: boolean | null = null

async function checkNvenc(): Promise<boolean> {
    if (_nvencAvailable !== null) return _nvencAvailable
    const ffPath = getFFmpegPath()
    return new Promise((resolve) => {
        const proc = spawn(ffPath, [
            '-y', '-f', 'lavfi', '-i', 'nullsrc=s=256x256:d=0.1',
            '-c:v', 'h264_nvenc', '-f', 'null', 'NUL',
        ], { shell: true, windowsHide: true })
        proc.on('close', (code) => { _nvencAvailable = code === 0; resolve(_nvencAvailable) })
        proc.on('error', () => { _nvencAvailable = false; resolve(false) })
        setTimeout(() => { if (_nvencAvailable === null) { proc.kill(); _nvencAvailable = false; resolve(false) } }, 8000)
    })
}

// â”€â”€ Helpers â”€â”€
function log(win: BrowserWindow, msg: string) {
    try { win.webContents.send('reup:log', msg) } catch { /* */ }
}
function logReplace(win: BrowserWindow, msg: string) {
    try { win.webContents.send('reup:logReplace', msg) } catch { /* */ }
}

function runFF(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        if (stopped) return reject(new Error('Stopped'))
        const proc = spawn(getFFmpegPath(), args, { windowsHide: true })
        activeProcs.push(proc)
        let stderr = ''
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
            activeProcs = activeProcs.filter(p => p !== proc)
            code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-300)}`))
        })
        proc.on('error', (e) => { activeProcs = activeProcs.filter(p => p !== proc); reject(e) })
    })
}

function runNVEnc(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        if (stopped) return reject(new Error('Stopped'))
        const nvencPath = getNVEncCPath()
        if (!nvencPath) return reject(new Error('NVEncC64 not found'))
        const proc = spawn(nvencPath, args, { windowsHide: true })
        activeProcs.push(proc)
        let stderr = ''
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.stdout?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
            activeProcs = activeProcs.filter(p => p !== proc)
            code === 0 ? resolve() : reject(new Error(`NVEncC exit ${code}: ${stderr.slice(-300)}`))
        })
        proc.on('error', (e) => { activeProcs = activeProcs.filter(p => p !== proc); reject(e) })
    })
}

function listVideos(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
        .filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(f => path.join(dir, f))
}

// â”€â”€ C++ AuraEngine path â”€â”€
function getEnginePath(): string | null {
    const appRoot = process.env.APP_ROOT || '.'
    const projectRoot = process.cwd()
    const candidates = [
        // Packaged EXE: resources/binaries/
        path.join(process.resourcesPath || '', 'binaries', 'aura_engine.exe'),
        // Dev mode
        path.join(appRoot, 'engine', 'build', 'Release', 'aura_engine.exe'),
        path.join(appRoot, 'engine', 'aura_engine.exe'),
        path.join(appRoot, 'binaries', 'aura_engine.exe'),
        path.join(projectRoot, 'engine', 'build', 'Release', 'aura_engine.exe'),
        path.join(projectRoot, 'engine', 'aura_engine.exe'),
        path.join(projectRoot, 'binaries', 'aura_engine.exe'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return p
        }
    }
    return null
}

// â”€â”€ Run C++ AuraEngine â”€â”€
// â”€â”€ Reusable engine config builder â”€â”€
// Builds the JSON config object for aura_engine.exe from a reup config.
// Used by: reup:start, autoPipeline, shufflePipeline
function buildEngineConfig(inputPath: string, outPath: string, config: any): object {
    const frameTemplate = config.frameTemplate || 'none'
    const frameDimMap: Record<string, { w: number; h: number }> = {
        '9:16': { w: 1080, h: 1920 },
        '1:1': { w: 1080, h: 1080 },
        '4:3': { w: 1440, h: 1080 },
        '3:4': { w: 1080, h: 1440 },
        '16:9': { w: 1920, h: 1080 },
    }
    const dims = frameDimMap[frameTemplate] || { w: 1080, h: 1920 }
    const appRoot = process.env.APP_ROOT || '.'

    const fontMap: Record<string, string> = {
        'Dancing Script': path.join(appRoot, 'fonts', 'DancingScript-Bold.ttf'),
        'Pacifico': path.join(appRoot, 'fonts', 'Pacifico-Regular.ttf'),
        'Lobster': path.join(appRoot, 'fonts', 'Lobster-Regular.ttf'),
        'Sigmar One': path.join(appRoot, 'fonts', 'SigmarOne-Regular.ttf'),
        'Bungee Shade': path.join(appRoot, 'fonts', 'BungeeShade-Regular.ttf'),
        'Patrick Hand': path.join(appRoot, 'fonts', 'PatrickHand-Regular.ttf'),
        'Dela Gothic One': path.join(appRoot, 'fonts', 'DelaGothicOne-Regular.ttf'),
        'Fugaz One': path.join(appRoot, 'fonts', 'FugazOne-Regular.ttf'),
        'Bangers': path.join(appRoot, 'fonts', 'Bangers-Regular.ttf'),
        'Inter': path.join(appRoot, 'fonts', 'Inter-Bold.ttf'),
        'Arial': 'C:/Windows/Fonts/arialbd.ttf',
        'Impact': 'C:/Windows/Fonts/impact.ttf',
    }
    const userFont = config.textFont || 'Inter'

    return {
        input: inputPath,
        output: outPath,
        width: dims.w,
        height: dims.h,
        gpu: true,
        speed: config.speed || 1.0,
        mirror: config.mirror || false,
        noise: !!config.noise,
        noiseIntensity: typeof config.noise === 'number' ? config.noise : 10,
        hdr: config.hdr || false,
        glow: config.glow || false,
        rgbDrift: config.rgbDrift || false,
        lensDistortion: config.lensDistortion || false,
        rotate: config.rotate || 0,
        borderWidth: config.borderWidth || 0,
        borderColor: config.borderColor || '#000000',
        colorGrading: config.colorGrading || 'none',
        zoomEffect: config.zoomEffect || false,
        zoomIntensity: config.zoomIntensity || 1.0,
        zoomPeriod: config.zoomPeriod || 16.0,
        zoomPhase: config.zoomPhase || 0.0,
        removeAudio: config.removeAudio || false,
        cropX: config.cropX || 0,
        cropY: config.cropY || 0,
        crop: config.crop || 0,
        reframeZoom: config.reframeZoom ?? 100,
        reframeScaleX: config.reframeScaleX ?? 100,
        reframeScaleY: config.reframeScaleY ?? 100,
        reframePosX: config.reframePosX ?? 0,
        reframePosY: config.reframePosY ?? 0,
        // Anti-detect intensity: slider 0-100 â†’ engine 0.0-1.0
        pixelEnlarge: (config.pixelEnlarge || 0) / 100,
        chromaShuffle: (config.chromaShuffle || 0) / 100,
        // Advanced anti-detect
        frameJitter: (config.frameJitter || 0) / 100,
        gammaShift: (config.gammaShift || 0) / 100,
        microColorCycle: (config.microColorCycle || 0) / 100,
        dctNoise: (config.dctNoise || 0) / 100,
        microZoom: config.microZoom || 1.0,
        bgBlur: !!(config.bgBlur && config.frameTemplate && config.frameTemplate !== 'none'),
        bgBlurAmount: config.bgBlurAmount || 40,
        logoPath: config.logoPath || '',
        logoSize: config.logoSize || 12,
        logoPosition: config.logoPosition || 'bottom-right',
        titleText: config.titleText || '',
        descText: config.descText || '',
        textFont: config.textFont || 'Inter',
        textColor: config.textColor || '#ffffff',
        titleFontSize: config.titleFontSize || 24,
        descFontSize: config.descFontSize || 14,
        titleOffsetX: config.titleOffsetX || 0,
        titleOffsetY: config.titleOffsetY || 0,
        descOffsetX: config.descOffsetX || 0,
        descOffsetY: config.descOffsetY || 0,
        srtPath: '',
        wordsJsonPath: '',
        assPath: '',
        fontsDir: path.join(appRoot, 'public', 'fonts'),
        subStyle: config.subStyle || 'bold_center',
        subFontPath: fontMap[userFont] || path.join(appRoot, 'fonts', 'Inter-Bold.ttf'),
        subFontSize: config.subFontSize || 22,
        subAnimation: config.subAnimation || 'fade',
        subColor: config.textColor || '#ffffff',
        subPosition: config.subPosition || 'bottom',
        overlayPath: config.overlayPath || '',
        overlayOpacity: config.overlayOpacity ?? 100,
        overlayBlink: config.overlayBlink || false,
        overlayBlinkSpeed: config.overlayBlinkSpeed || 1.0,
        overlayInterval: config.overlayInterval || 3.0,
        audioEvade: config.audioEvade || false,
        volumeBoost: config.volumeBoost || 1.0,
        crf: 23,
        preset: 'p1',
        // vFilterChain whitelist: only drawbox, drawtext, rgbashift
        vFilterChain: (() => {
            const { vf } = buildFilterChain(config)
            if (!vf) return ''
            // vFilterChain whitelist: drawbox, drawtext, rgbashift + anti-detect arsenal
            return vf
                .split(',')
                .filter(f => f.startsWith('drawbox=') || f.startsWith('drawtext=') || f.startsWith('rgbashift=')
                    || f.startsWith('hue=') || f.startsWith('scale=') || f.startsWith('crop=')
                    || f.startsWith('setsar=') || f.startsWith('fade=') || f.startsWith('setpts=')
                    || f.startsWith('noise=') || f.startsWith('atempo=')
                    || f.startsWith('eq=') || f.startsWith('vignette=') || f.startsWith('colorbalance='))
                .join(',')
        })(),
    }
}

function runEngine(enginePath: string, configJson: object, win: BrowserWindow): Promise<void> {
    return new Promise((resolve, reject) => {
        if (stopped) return reject(new Error('Stopped'))

        // Write config to temp JSON file
        const tmpConfig = path.join(os.tmpdir(), `aura_config_${Date.now()}.json`)
        fs.writeFileSync(tmpConfig, JSON.stringify(configJson), 'utf-8')
        // Create minimal fontconfig to suppress "Cannot load default config file" errors
        const fontsDir = path.join(path.dirname(enginePath), '..', '..', 'fonts')
        const fontconfPath = path.join(os.tmpdir(), 'aura_fonts.conf')
        if (!fs.existsSync(fontconfPath)) {
            const winFonts = 'C:/Windows/Fonts'
            fs.writeFileSync(fontconfPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${winFonts}</dir>
  <dir>${fontsDir.replace(/\\/g, '/')}</dir>
  <cachedir>${os.tmpdir().replace(/\\/g, '/')}/fontconfig-cache</cachedir>
</fontconfig>`, 'utf-8')
        }

        const proc = spawn(enginePath, ['--config', tmpConfig], {
            windowsHide: true,
            env: {
                ...process.env,
                FONTCONFIG_FILE: fontconfPath,
                FONTCONFIG_PATH: path.dirname(fontconfPath),
            }
        })
        activeProcs.push(proc)


        // Read progress from stdout (JSON lines)
        proc.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(l => l.trim())
            for (const line of lines) {
                try {
                    const j = JSON.parse(line)
                    if (j.progress !== undefined) {
                        const pct = Math.round(j.progress * 100)
                        // Replace last line (no spam)
                        logReplace(win, `  âš¡ Processing: ${pct}% (${Math.round(j.fps || 0)} fps)`)
                    }
                    if (j.done) {
                        log(win, j.success ? '  âœ… Engine done' : '  âŒ Engine failed')
                    }
                } catch { /* not JSON, skip */ }
            }
        })

        let stderr = ''
        const engineLogPath = path.join(path.dirname(enginePath), 'engine_last.log')
        try { fs.writeFileSync(engineLogPath, '=== Engine started: ' + new Date().toISOString() + ' ===\n', 'utf-8') } catch {}
        proc.stderr?.on('data', (d: Buffer) => {
            const s = d.toString()
            stderr += s
            try { fs.appendFileSync(engineLogPath, s, 'utf-8') } catch {}
            const sLines = s.split('\n')
            for (const sLine of sLines) {
                const trimmed = sLine.trim()
                if (!trimmed) continue
                // Forward only errors/warnings to UI (verbose debug goes to log file only)
                if (trimmed.includes('Error') || trimmed.includes('error') || trimmed.includes('âŒ') || trimmed.includes('Warning'))
                    log(win, `  ${trimmed}`)
            }
        })
        proc.on('close', (code) => {
            clearTimeout(engineTimeout)
            activeProcs = activeProcs.filter(p => p !== proc)
            try { fs.unlinkSync(tmpConfig) } catch { /* */ }

            code === 0 ? resolve() : reject(new Error(`Engine exit ${code}: ${stderr.slice(-300)}`))
        })
        proc.on('error', (e) => {
            clearTimeout(engineTimeout)
            activeProcs = activeProcs.filter(p => p !== proc)
            try { fs.unlinkSync(tmpConfig) } catch { /* */ }
            reject(e)
        })
        // Safety: kill engine if stuck for 10 minutes
        const engineTimeout = setTimeout(() => {
            try { proc.kill('SIGTERM') } catch { /* */ }
            log(win, '  ⚠️ Engine quá 10 phút — tự dừng.')
            reject(new Error('Engine timeout (10 min)'))
        }, 10 * 60 * 1000)
    })
}

// â”€â”€ Process single video â”€â”€
async function processVideo(inputPath: string, outputDir: string, config: ReupConfig, useGpu: boolean): Promise<string> {
    const basename = path.basename(inputPath, path.extname(inputPath))
    const outPath = path.join(outputDir, `${basename}_REUP.mp4`)

    // â”€â”€ Try C++ AuraEngine first (fastest â€” direct FFmpeg API, no subprocess overhead) â”€â”€
    const enginePath = getEnginePath()
    if (enginePath) {
        try {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) log(win, `âš¡ Using C++ AuraEngine...`)

            const frameTemplate = config.frameTemplate || 'none'
            // Match getFrameDimensions in reup-filters.ts (colon format: '9:16', '1:1', etc.)
            const frameDimMap: Record<string, { w: number; h: number }> = {
                '9:16': { w: 1080, h: 1920 },
                '1:1': { w: 1080, h: 1080 },
                '4:3': { w: 1440, h: 1080 },
                '3:4': { w: 1080, h: 1440 },
                '16:9': { w: 1920, h: 1080 },
            }
            const dims = frameDimMap[frameTemplate] || { w: 1080, h: 1920 }

            await runEngine(enginePath, {
                input: inputPath,
                output: outPath,
                width: dims.w,
                height: dims.h,
                gpu: useGpu,
                speed: config.speed || 1.0,
                mirror: config.mirror || false,
                noise: !!config.noise,
                noiseIntensity: typeof config.noise === 'number' ? config.noise : 10,
                hdr: config.hdr || false,
                glow: config.glow || false,
                rgbDrift: config.rgbDrift || false,
                lensDistortion: config.lensDistortion || false,
                rotate: config.rotate || 0,
                borderWidth: config.borderWidth || 0,
                borderColor: config.borderColor || '#000000',
                colorGrading: config.colorGrading || 'none',
                zoomEffect: config.zoomEffect || false,
                zoomIntensity: config.zoomIntensity || 1.0,
                zoomPeriod: config.zoomPeriod || 16.0,
                zoomPhase: config.zoomPhase || 0.0,
                removeAudio: config.removeAudio || false,
                cropX: config.cropX || 0,
                cropY: config.cropY || 0,
                crop: config.crop || 0,
                // Reframe
                reframeZoom: config.reframeZoom ?? 100,
                reframeScaleX: config.reframeScaleX ?? 100,
                reframeScaleY: config.reframeScaleY ?? 100,
                reframePosX: config.reframePosX ?? 0,
                reframePosY: config.reframePosY ?? 0,
                // Pixel anti-detect
                pixelEnlarge: config.pixelEnlarge || false,
                chromaShuffle: config.chromaShuffle || false,
                // BG Blur
                bgBlur: !!(config.bgBlur && config.frameTemplate && config.frameTemplate !== 'none'),
                bgBlurAmount: config.bgBlurAmount || 40,
                // Logo
                logoPath: config.logoPath || '',
                logoSize: config.logoSize || 12,
                logoPosition: config.logoPosition || 'bottom-right',
                // Title
                titleText: config.titleText || '',
                descText: config.descText || '',
                textFont: config.textFont || 'Inter',
                textColor: config.textColor || '#ffffff',
                titleFontSize: config.titleFontSize || 24,
                descFontSize: config.descFontSize || 14,
                titleOffsetX: config.titleOffsetX || 0,
                titleOffsetY: config.titleOffsetY || 0,
                descOffsetX: config.descOffsetX || 0,
                descOffsetY: config.descOffsetY || 0,
                // Subtitle
                srtPath: config.srtPath || '',
                // Audio
                audioEvade: config.audioEvade || false,
                volumeBoost: config.volumeBoost || 1.0,
                crf: 23,
                preset: 'p1',
            }, win!)

            return outPath
        } catch (e: any) {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) log(win, `  âš ï¸ Engine fallback â†’ FFmpeg: ${e.message}`)
            // Fall through to NVEncC/FFmpeg
        }
    }

    // Determine rendering path
    const nvencAvail = isNVEncCAvailable()
    const nvencCompat = canUseNVEncC(config)
    const willUseNVEncC = useGpu && nvencAvail && nvencCompat
    const { vf, af, complexFilter, extraInputs, needsMapping } = buildFilterChain(config)

    // Try NVEncC + libplacebo shaders (10-15x faster) if compatible
    if (willUseNVEncC) {
        try {
            if (needsSeparateAudio(config)) {
                // Audio effects need FFmpeg â€” process audio separately
                const tmpVideo = path.join(outputDir, `${basename}_tmpvideo.mp4`)
                const tmpAudio = path.join(outputDir, `${basename}_tmpaudio.aac`)

                // Detect input codec for H.265 compatibility
                const inputCodec = detectInputCodec(inputPath)
                // Step 1: NVEncC encodes video (no audio)
                const nvArgs = buildNVEncCArgs(config, inputPath, tmpVideo, false, inputCodec)
                await runNVEnc(nvArgs)

                // Step 2: FFmpeg extracts + processes audio
                const { af } = buildFilterChain(config)
                const audioArgs = ['-y', '-i', inputPath]
                if (af) audioArgs.push('-af', af)
                audioArgs.push('-vn', '-c:a', 'aac', '-b:a', '192k', tmpAudio)
                await runFF(audioArgs)

                // Step 3: FFmpeg muxes video + audio
                await runFF(['-y', '-i', tmpVideo, '-i', tmpAudio,
                    '-c:v', 'copy', '-c:a', 'copy',
                    '-movflags', '+faststart', outPath])

                // Cleanup temp files
                try { fs.unlinkSync(tmpVideo) } catch { /* */ }
                try { fs.unlinkSync(tmpAudio) } catch { /* */ }
            } else {
                // No audio effects â€” NVEncC handles everything
                const inputCodecDirect = detectInputCodec(inputPath)
                const nvArgs = buildNVEncCArgs(config, inputPath, outPath, false, inputCodecDirect)
                await runNVEnc(nvArgs)
            }

            // Speed post-processing: NVEncC Ä‘Ã£ render video â†’ FFmpeg chá»‰ setpts + atempo (nhanh)
            if (needsSpeedPostProcess(config)) {
                const tmpSpeed = path.join(outputDir, `${basename}_tmpspeed.mp4`)
                fs.renameSync(outPath, tmpSpeed)
                const speedArgs = ['-y', '-i', tmpSpeed,
                    '-vf', `setpts=PTS/${config.speed.toFixed(3)}`,
                    '-af', `atempo=${config.speed.toFixed(3)}`,
                    '-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23',
                    '-c:a', 'aac', '-b:a', '192k',
                    '-movflags', '+faststart', outPath]
                await runFF(speedArgs)
                try { fs.unlinkSync(tmpSpeed) } catch { /* */ }
            }

            return outPath
        } catch {
            // NVEncC failed â€” fallback to FFmpeg below
        }
    }

    // FFmpeg path â€” sá»­ dá»¥ng filter chain Ä‘Ã£ build á»Ÿ trÃªn (debug section)

    const args: string[] = ['-y']
    if (useGpu) args.push('-hwaccel', 'cuda')
    args.push('-i', inputPath)
    for (const inp of extraInputs) args.push('-i', inp)
    if (complexFilter) {
        args.push('-filter_complex', complexFilter)
        // filter_complex cáº§n -map Ä‘á»ƒ chá»n output stream
        if (needsMapping) args.push('-map', '[v]', '-map', '0:a?')
    } else if (vf) {
        args.push('-vf', vf)
    }
    if (af) args.push('-af', af)
    if (config.cleanMetadata) args.push('-map_metadata', '-1')

    if (useGpu) args.push('-c:v', 'h264_nvenc', '-preset', 'p2', '-cq', _rv ? '23' : '40')
    else args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', _rv ? '23' : '40')



    args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-loglevel', 'error', outPath)
    await runFF(args)
    return outPath
}

// â”€â”€ Main pipeline â”€â”€
async function runReup(config: ReupConfig, win: BrowserWindow): Promise<boolean> {
    stopped = false
    const videos = listVideos(config.inputFolder)
    if (videos.length === 0) { log(win, 'âŒ No videos found'); return false }

    const outputDir = path.join(config.inputFolder, '_REUP')
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

    const useGpu = await checkNvenc()
    const enginePath = getEnginePath()
    if (enginePath) {
        log(win, `ðŸ”¥ C++ AuraEngine FOUND: ${enginePath}`)
        log(win, `   â†’ Export sáº½ dÃ¹ng C++ Engine (nhanh nháº¥t)`)
    } else {
        log(win, `â„¹ï¸ C++ Engine not found â†’ dÃ¹ng ${useGpu ? 'FFmpeg GPU (NVENC)' : 'FFmpeg CPU'}`)
    }
    log(win, useGpu ? 'ðŸš€ GPU (NVENC)' : 'ðŸ’» CPU (libx264)')
    log(win, `ðŸ“‚ ${videos.length} videos â†’ _REUP/`)

    const parallel = useGpu ? 3 : Math.min(os.cpus().length, 8)
    let completed = 0, failed = 0

    async function worker(queue: string[]) {
        while (queue.length > 0 && !stopped) {
            const file = queue.shift()!
            const name = path.basename(file)
            try {
                log(win, `[${completed + failed + 1}/${videos.length}] âš¡ ${name}`)
                await processVideo(file, outputDir, config, useGpu)
                completed++
                log(win, `[${completed + failed}/${videos.length}] âœ… ${name}`)
            } catch (e: any) {
                failed++
                log(win, `[${completed + failed}/${videos.length}] âŒ ${name}: ${e.message}`)
            }
        }
    }

    const queue = [...videos]
    await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, () => worker(queue)))

    if (stopped) { log(win, 'â¹ Stopped'); return false }
    log(win, `\nâœ… DONE: ${completed}/${videos.length} success, ${failed} failed`)
    log(win, `ðŸ“‚ ${outputDir}`)
    return true
}

// â”€â”€ Get video duration (seconds) â”€â”€
function getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const probePath = getFFprobePath()
        const proc = spawn(probePath, [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', filePath,
        ], { windowsHide: true })
        let out = ''
        let err = ''
        proc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
        proc.stderr?.on('data', (d: Buffer) => { err += d.toString() })
        proc.on('close', (code) => {
            const dur = parseFloat(out.trim())
            if (code === 0 && !isNaN(dur)) resolve(dur)
            else reject(new Error(`ffprobe exit ${code}: ${err.slice(-200) || out.slice(-100) || 'no output'} | path: ${probePath}`))
        })
        proc.on('error', (e) => reject(new Error(`ffprobe spawn error: ${e.message} | path: ${probePath}`)))
    })
}

// â”€â”€ Split single video â”€â”€
async function splitVideo(
    inputPath: string, outputDir: string,
    splitMode: string, segmentLength: number, cutAtSecond: number,
    win: BrowserWindow
): Promise<number> {
    const basename = path.basename(inputPath, path.extname(inputPath))
    const ext = path.extname(inputPath)
    const duration = await getVideoDuration(inputPath)

    let segments: { start: number; duration: number; label: string }[] = []

    if (splitMode === 'half') {
        const half = duration / 2
        segments = [
            { start: 0, duration: half, label: `${basename}_part1${ext}` },
            { start: half, duration: half, label: `${basename}_part2${ext}` },
        ]
    } else if (splitMode === 'at_second') {
        // Cut at exact second
        const cutAt = Math.min(cutAtSecond, duration)
        if (cutAt > 0.5) {
            segments.push({ start: 0, duration: cutAt, label: `${basename}_part1${ext}` })
        }
        if (duration - cutAt > 0.5) {
            segments.push({ start: cutAt, duration: duration - cutAt, label: `${basename}_part2${ext}` })
        }
    } else {
        // segments mode â€” split by duration
        let idx = 1
        for (let t = 0; t < duration; t += segmentLength) {
            const len = Math.min(segmentLength, duration - t)
            if (len < 0.5) break // skip tiny remainders
            segments.push({ start: t, duration: len, label: `${basename}_seg${String(idx).padStart(3, '0')}${ext}` })
            idx++
        }
    }

    for (const seg of segments) {
        if (stopped) break
        const outPath = path.join(outputDir, seg.label)
        const args = [
            '-y', '-ss', String(seg.start),
            '-i', inputPath,
            '-t', String(seg.duration),
            '-c', 'copy',
            '-movflags', '+faststart', outPath,
        ]
        await runFF(args)
        log(win, `  â†’ ${seg.label}`)
    }
    return segments.length
}
// â”€â”€ Scene Detection using FFmpeg â”€â”€
function detectScenes(filePath: string, threshold: number, _win: BrowserWindow): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const args = [
            '-i', `"${filePath}"`,
            '-vf', `select='gt(scene\\,${threshold})',showinfo`,
            '-f', 'null', 'NUL',
        ]
        const proc = spawn(getFFmpegPath(), args, { shell: true, windowsHide: true })
        activeProcs.push(proc)
        let stderr = ''
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (_code) => {
            activeProcs = activeProcs.filter(p => p !== proc)
            // Parse showinfo output for timestamps: pts_time:123.456
            const timestamps: number[] = [0] // always start at 0
            const regex = /pts_time:\s*([\d.]+)/g
            let match
            while ((match = regex.exec(stderr)) !== null) {
                const t = parseFloat(match[1])
                if (!isNaN(t) && t > 0) timestamps.push(t)
            }
            resolve(timestamps)
        })
        proc.on('error', (e) => {
            activeProcs = activeProcs.filter(p => p !== proc)
            reject(e)
        })
    })
}

// â”€â”€ Split by detected scenes â”€â”€
async function splitByScenes(
    inputPath: string, outputDir: string,
    timestamps: number[], duration: number,
    minSceneSec: number, win: BrowserWindow
): Promise<number> {
    const basename = path.basename(inputPath, path.extname(inputPath))
    const ext = path.extname(inputPath)

    // Filter out scenes shorter than minSceneSec
    const filtered: number[] = [timestamps[0]]
    for (let i = 1; i < timestamps.length; i++) {
        if (timestamps[i] - filtered[filtered.length - 1] >= minSceneSec) {
            filtered.push(timestamps[i])
        }
    }

    // Build segments from timestamps
    const segments: { start: number; end: number; label: string }[] = []
    for (let i = 0; i < filtered.length; i++) {
        const start = filtered[i]
        const end = i + 1 < filtered.length ? filtered[i + 1] : duration
        if (end - start < 0.1) continue
        segments.push({
            start,
            end,
            label: `${basename}_Canh-${String(i + 1).padStart(3, '0')}${ext}`,
        })
    }

    // Split each segment
    for (const seg of segments) {
        if (stopped) break
        const outPath = path.join(outputDir, seg.label)
        const args = [
            '-y', '-ss', String(seg.start),
            '-i', inputPath,
            '-t', String(seg.end - seg.start),
            '-c', 'copy',
            '-movflags', '+faststart', outPath,
        ]
        await runFF(args)
        log(win, `  â†’ ${seg.label}`)
    }

    // Write CSV
    const csvPath = path.join(outputDir, `${basename}_scenes.csv`)
    const csvLines = ['Scene,Start,End,Duration']
    segments.forEach((seg, i) => {
        const dur = (seg.end - seg.start).toFixed(2)
        csvLines.push(`${String(i + 1).padStart(3, '0')},${seg.start.toFixed(3)},${seg.end.toFixed(3)},${dur}`)
    })
    fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf-8')

    return segments.length
}

// â”€â”€ Split pipeline â”€â”€
async function runSplit(config: any, win: BrowserWindow): Promise<boolean> {
    stopped = false
    const videos = listVideos(config.inputFolder)
    if (videos.length === 0) { log(win, 'âŒ No videos found'); return false }

    const mode = config.splitMode || 'segments'
    const isScene = mode === 'scenes'
    const outputDir = path.join(config.inputFolder, isScene ? '_TACH_CANH' : '_SPLIT')
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

    if (isScene) {
        const threshold = config.sceneThreshold || 0.3
        const minScene = config.minSceneSec || 0.35
        log(win, `ðŸŽ¬ Scene Detect: threshold=${threshold}, min=${minScene}s`)
        log(win, `ðŸ“‚ ${videos.length} videos â†’ _TACH_CANH/`)

        let completed = 0, failed = 0
        for (const file of videos) {
            if (stopped) break
            const name = path.basename(file)
            try {
                log(win, `[${completed + failed + 1}/${videos.length}] ðŸ” Detecting: ${name}`)
                const scenes = await detectScenes(file, threshold, win)
                const duration = await getVideoDuration(file)
                log(win, `  â†’ Found ${scenes.length - 1} scene changes`)

                // Create per-video subfolder
                const videoOutDir = path.join(outputDir, path.basename(file, path.extname(file)))
                if (!fs.existsSync(videoOutDir)) fs.mkdirSync(videoOutDir, { recursive: true })

                const parts = await splitByScenes(file, videoOutDir, scenes, duration, minScene, win)
                completed++
                log(win, `[${completed + failed}/${videos.length}] âœ… ${name} â†’ ${parts} scenes`)
            } catch (e: any) {
                failed++
                log(win, `[${completed + failed}/${videos.length}] âŒ ${name}: ${e.message}`)
            }
        }

        if (stopped) { log(win, 'â¹ Stopped'); return false }
        log(win, `\nâœ… DONE: ${completed}/${videos.length} success, ${failed} failed`)
        log(win, `ðŸ“‚ ${outputDir}`)
        return true
    }

    // Duration-based split
    const segLen = config.segmentLength || 15
    log(win, `âœ‚ï¸ Split by ${segLen}s`)
    log(win, `ðŸ“‚ ${videos.length} videos â†’ _SPLIT/`)

    let completed = 0, failed = 0
    for (const file of videos) {
        if (stopped) break
        const name = path.basename(file)
        try {
            log(win, `[${completed + failed + 1}/${videos.length}] âœ‚ï¸ ${name}`)
            const parts = await splitVideo(file, outputDir, mode, segLen, 0, win)
            completed++
            log(win, `[${completed + failed}/${videos.length}] âœ… ${name} â†’ ${parts} parts`)
        } catch (e: any) {
            failed++
            log(win, `[${completed + failed}/${videos.length}] âŒ ${name}: ${e.message}`)
        }
    }

    if (stopped) { log(win, 'â¹ Stopped'); return false }
    log(win, `\nâœ… DONE: ${completed}/${videos.length} success, ${failed} failed`)
    log(win, `ðŸ“‚ ${outputDir}`)
    return true
}

// â”€â”€ IPC Registration â”€â”€

// -- Cleanup orphaned temp files from previous runs --
function cleanupOldTempFiles(): void {
    try {
        const tmpBase = os.tmpdir()
        const entries = fs.readdirSync(tmpBase)
        let cleaned = 0, freedMB = 0

        for (const entry of entries) {
            const isAuraSplit = (
                entry.startsWith('aura_config_') ||
                entry.startsWith('aurasplit_export_') ||
                entry.startsWith('aurasplit_sub_') ||
                entry.startsWith('aurasplit_engine_') ||
                entry.startsWith('aura_fonts') ||
                entry === 'fontconfig-cache'
            )
            if (!isAuraSplit) continue

            const fullPath = path.join(tmpBase, entry)
            try {
                const stat = fs.statSync(fullPath)
                // Only clean files/dirs older than 1 hour (avoid cleaning active exports)
                const ageMs = Date.now() - stat.mtimeMs
                if (ageMs < 3600000) continue

                if (stat.isDirectory()) {
                    try {
                        const files = fs.readdirSync(fullPath)
                        for (const f of files) {
                            try { freedMB += fs.statSync(path.join(fullPath, f)).size / (1024 * 1024) } catch (_e) { /* */ }
                        }
                    } catch (_e) { /* */ }
                    fs.rmSync(fullPath, { recursive: true, force: true })
                } else {
                    freedMB += stat.size / (1024 * 1024)
                    fs.unlinkSync(fullPath)
                }
                cleaned++
            } catch (_e) { /* skip locked files */ }
        }

        if (cleaned > 0) {
            console.log(`[CLEANUP] Removed ${cleaned} orphaned temp items (${Math.round(freedMB)} MB freed)`)
        }
    } catch (_e) {
        console.warn('[CLEANUP] Error:', _e)
    }
}
export function registerReupIPC(): void {
    // Clean orphaned temp files from previous runs
    cleanupOldTempFiles()

    ipcMain.handle('reup:scan', async (_e, { folderPath }) => ({ videos: listVideos(folderPath) }))

    ipcMain.handle('reup:run', async (event, { config }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'No window' }
        // Route by mode
        if (config?.mode === 'split') {
            return { success: await runSplit(config, win) }
        }
        return { success: await runReup(config, win) }
    })

    ipcMain.handle('reup:stop', async () => {
        stopped = true
        for (const p of activeProcs) { try { p.kill('SIGTERM') } catch { /* */ } }
        activeProcs = []
        return { stopped: true }
    })

    // â”€â”€ Fast Export: Split & Stitch + GPU Pipeline â”€â”€

    /** Encode a single chunk â€” NVEncC + shaders first, FFmpeg fallback */
    async function encodeChunk(
        chunkPath: string, outPath: string,
        vf: string, af: string, complexFilter: string, extraInputs: string[],
        config: ReupConfig, useGpu: boolean, useNVEncC: boolean,
        needsMapping: boolean = false
    ): Promise<void> {
        // Try NVEncC + libplacebo shaders (full GPU pipeline, 10-15x faster)
        if (useNVEncC) {
            try {
                if (needsSeparateAudio(config)) {
                    // Audio effects need FFmpeg â€” process separately
                    const tmpVideo = outPath.replace('.mp4', '_tmpv.mp4')
                    const tmpAudio = outPath.replace('.mp4', '_tmpa.aac')

                    // Step 1: NVEncC encodes video (no audio)
                    const chunkCodec = detectInputCodec(chunkPath)
                    const nvArgs = buildNVEncCArgs(config, chunkPath, tmpVideo, false, chunkCodec)
                    await runNVEnc(nvArgs)

                    // Step 2: FFmpeg processes audio
                    const audioArgs = ['-y', '-i', chunkPath]
                    if (af) audioArgs.push('-af', af)
                    audioArgs.push('-vn', '-c:a', 'aac', '-b:a', '192k', tmpAudio)
                    await runFF(audioArgs)

                    // Step 3: Mux video + audio
                    await runFF(['-y', '-i', tmpVideo, '-i', tmpAudio,
                        '-c:v', 'copy', '-c:a', 'copy',
                        '-movflags', '+faststart', outPath])

                    // Cleanup
                    try { fs.unlinkSync(tmpVideo) } catch { /* */ }
                    try { fs.unlinkSync(tmpAudio) } catch { /* */ }
                } else {
                    // No audio effects â€” NVEncC handles everything
                    const chunkCodecDirect = detectInputCodec(chunkPath)
                    const nvArgs = buildNVEncCArgs(config, chunkPath, outPath, false, chunkCodecDirect)
                    await runNVEnc(nvArgs)
                }

                // Speed post-processing: NVEncC Ä‘Ã£ render â†’ FFmpeg setpts + atempo (nhanh vá»›i NVENC)
                if (needsSpeedPostProcess(config)) {
                    const tmpSpeed = outPath.replace('.mp4', '_tmpspd.mp4')
                    fs.renameSync(outPath, tmpSpeed)
                    const speedArgs = ['-y', '-i', tmpSpeed,
                        '-vf', `setpts=PTS/${config.speed.toFixed(3)}`,
                        '-af', `atempo=${config.speed.toFixed(3)}`,
                        '-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23',
                        '-c:a', 'aac', '-b:a', '192k',
                        '-movflags', '+faststart', outPath]
                    await runFF(speedArgs)
                    try { fs.unlinkSync(tmpSpeed) } catch { /* */ }
                }

                return
            } catch {
                // NVEncC failed â€” fallback to FFmpeg
            }
        }

        // FFmpeg fallback path
        // KHÃ”NG dÃ¹ng -hwaccel_output_format nv12! NÃ³ giá»¯ frames trÃªn GPU nv12 format
        // â†’ subtitles, colorchannelmixer, overlay... KHÃ”NG cháº¡y Ä‘Æ°á»£c trÃªn GPU frames
        // Chá»‰ dÃ¹ng -hwaccel cuda (auto download frames vá» CPU cho software filters)
        const args: string[] = ['-y']
        if (useGpu) args.push('-hwaccel', 'cuda')
        args.push('-i', chunkPath)
        for (const inp of extraInputs) args.push('-i', inp)
        if (complexFilter) {
            args.push('-filter_complex', complexFilter)
            // filter_complex cáº§n -map Ä‘á»ƒ chá»n output stream (logo overlay â†’ [v])
            if (needsMapping) args.push('-map', '[v]', '-map', '0:a?')
        } else if (vf) {
            args.push('-vf', vf)
        }
        if (af) args.push('-af', af)
        if (config.cleanMetadata) args.push('-map_metadata', '-1')
        if (useGpu) args.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23')
        else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
        args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath)

        // DEBUG: Log FFmpeg command to debug file
        const debugPath2 = path.join(os.homedir(), 'Desktop', 'REUP_DEBUG.txt')
        try {
            const cmdLine = `\n\nâ•â•â• ENCODE CHUNK â•â•â•\nCMD: ffmpeg ${args.join(' ')}\n`
            fs.appendFileSync(debugPath2, cmdLine, 'utf-8')
        } catch { /* */ }

        // Run FFmpeg and capture stderr
        await new Promise<void>((resolve, reject) => {
            if (stopped) return reject(new Error('Stopped'))
            const proc = spawn(getFFmpegPath(), args, { windowsHide: true })
            activeProcs.push(proc)
            let stderr = ''
            proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
            proc.on('close', (code) => {
                activeProcs = activeProcs.filter(p => p !== proc)
                // Append stderr to debug file
                try {
                    fs.appendFileSync(debugPath2, `EXIT: ${code}\nSTDERR:\n${stderr.slice(-500)}\n`, 'utf-8')
                } catch { /* */ }
                code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-300)}`))
            })
            proc.on('error', (e) => { activeProcs = activeProcs.filter(p => p !== proc); reject(e) })
        })
    }

    /** Split & Stitch parallel export */
    async function fastExport(
        inputPath: string, outPath: string,
        config: ReupConfig, useGpu: boolean,
        win: BrowserWindow
    ): Promise<void> {
        const duration = await getVideoDuration(inputPath)
        const CHUNK_SEC = 30       // seconds per chunk
        const MAX_PARALLEL = useGpu ? 3 : Math.min(os.cpus().length, 4)

        const numChunks = Math.max(1, Math.ceil(duration / CHUNK_SEC))
        const tmpDir = path.join(os.tmpdir(), `aurasplit_export_${Date.now()}`)
        fs.mkdirSync(tmpDir, { recursive: true })

        try {
            // â”€â”€ Phase 1: Split at keyframes (instant, -c copy) â”€â”€
            log(win, `âœ‚ï¸ Splitting into ${numChunks} chunks...`)
            const chunkPaths: string[] = []

            for (let i = 0; i < numChunks; i++) {
                if (stopped) throw new Error('Stopped')
                const start = i * CHUNK_SEC
                const chunkLen = Math.min(CHUNK_SEC, duration - start)
                if (chunkLen < 0.1) break

                const chunkFile = path.join(tmpDir, `chunk_${String(i).padStart(4, '0')}.mp4`)
                chunkPaths.push(chunkFile)

                await runFF([
                    '-y', '-ss', String(start),
                    '-i', inputPath,
                    '-t', String(chunkLen),
                    '-c', 'copy', '-avoid_negative_ts', '1',
                    '-movflags', '+faststart', chunkFile,
                ])
            }

            // â”€â”€ Phase 2: Encode chunks in parallel â”€â”€
            const useNVEncC = useGpu && isNVEncCAvailable() && canUseNVEncC(config)
            const encoderLabel = useNVEncC ? 'âš¡ NVEncC (full GPU)' : (useGpu ? 'ðŸš€ FFmpeg+NVENC' : 'ðŸ’» FFmpeg CPU')
            log(win, `${encoderLabel} â€” Encoding ${chunkPaths.length} chunks Ã— ${MAX_PARALLEL} parallel...`)
            const { vf, af, complexFilter, extraInputs, needsMapping } = buildFilterChain(config)

            // â”€â”€â”€ DEBUG: Ghi file debug ra Desktop â”€â”€â”€
            const debugPath = path.join(os.homedir(), 'Desktop', 'REUP_DEBUG.txt')
            try {
                fs.writeFileSync(debugPath, [
                    'â•â•â• REUP DEBUG: fastExport â•â•â•',
                    `Time: ${new Date().toISOString()}`,
                    `useGpu: ${useGpu}`,
                    `useNVEncC: ${useNVEncC}`,
                    `Chunks: ${chunkPaths.length}`,
                    '',
                    'CONFIG:', JSON.stringify(config, null, 2),
                    '',
                    'VF:', vf || '(empty)',
                    'AF:', af || '(empty)',
                    'ComplexFilter:', complexFilter || '(empty)',
                    'NeedsMapping:', String(needsMapping),
                    'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
                ].join('\n'), 'utf-8')
            } catch { /* */ }
            const encodedPaths: string[] = []
            const queue = [...chunkPaths]
            let doneCount = 0

            async function worker() {
                while (queue.length > 0 && !stopped) {
                    const chunk = queue.shift()!
                    const idx = chunkPaths.indexOf(chunk)
                    const encodedFile = path.join(tmpDir, `enc_${String(idx).padStart(4, '0')}.mp4`)
                    encodedPaths[idx] = encodedFile

                    await encodeChunk(chunk, encodedFile, vf, af, complexFilter, extraInputs, config, useGpu, useNVEncC, needsMapping)
                    doneCount++
                    log(win, `  [${doneCount}/${chunkPaths.length}] âœ… chunk ${idx + 1}`)
                }
            }

            await Promise.all(
                Array.from({ length: Math.min(MAX_PARALLEL, chunkPaths.length) }, () => worker())
            )

            if (stopped) throw new Error('Stopped')

            // â”€â”€ Phase 3: Concat encoded chunks â”€â”€
            log(win, `ðŸ”— Stitching ${encodedPaths.length} chunks...`)
            const concatList = path.join(tmpDir, 'concat.txt')
            const lines = encodedPaths.map(p => `file '${p.replace(/\\/g, '/')}'`)
            fs.writeFileSync(concatList, lines.join('\n'), 'utf-8')

            // Concat to temp file first (post-processing may need another pass)
            const needsPostProcess = !!(
                config.overlayPath ||
                (config.interleaveEnabled && config.interleaveFolderPath) ||
                config.removeAudio ||
                config.srtPath
            )
            const concatOut = needsPostProcess
                ? path.join(tmpDir, 'concat_out.mp4')
                : outPath

            await runFF([
                '-y', '-f', 'concat', '-safe', '0',
                '-i', concatList,
                '-c', 'copy', '-movflags', '+faststart',
                concatOut,
            ])

            // â”€â”€ Phase 3.5: Post-concat processing â”€â”€
            let currentFile = concatOut

            // â”€â”€ Overlay (video/image with opacity + interval + blink) â”€â”€
            if (config.overlayPath && fs.existsSync(config.overlayPath)) {
                log(win, `ðŸŽ­ Applying overlay...`)
                const overlayOut = path.join(tmpDir, 'overlay_out.mp4')
                const opacity = Math.pow((config.overlayOpacity || 60) / 100, 3)
                let overlayFilter = ''

                const interval = config.overlayInterval || 0  // 0 = always visible
                const blinkSpeed = config.overlayBlinkSpeed || 0.1

                if (interval > 0 && config.overlayBlink) {
                    // BOTH interval + blink: show/hide every interval seconds, flash rapidly during ON
                    // Interval cycle: ON for interval sec â†’ OFF for interval sec
                    // Blink: within ON window, flash on/off every blinkSpeed sec
                    const cycle = interval * 2
                    const enableExpr = `lt(mod(t\\,${cycle})\\,${interval})*lt(mod(t\\,${blinkSpeed * 2})\\,${blinkSpeed})`
                    overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                        `[0:v][ov]overlay=0:0:enable='${enableExpr}'[v]`
                } else if (interval > 0) {
                    // Interval ONLY: ON for interval sec â†’ OFF for interval sec â†’ repeat
                    const cycle = interval * 2
                    overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                        `[0:v][ov]overlay=0:0:enable='lt(mod(t\\,${cycle})\\,${interval})'[v]`
                } else if (config.overlayBlink) {
                    // Blink ONLY: flash on/off rapidly every blinkSpeed seconds
                    overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                        `[0:v][ov]overlay=0:0:enable='lt(mod(t\\,${blinkSpeed * 2})\\,${blinkSpeed})'[v]`
                } else {
                    // Always visible with opacity
                    overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                        `[0:v][ov]overlay=0:0[v]`
                }

                const ovArgs = ['-y']
                if (useGpu) ovArgs.push('-hwaccel', 'cuda')
                ovArgs.push('-i', currentFile, '-i', config.overlayPath)
                ovArgs.push('-filter_complex', overlayFilter)
                ovArgs.push('-map', '[v]', '-map', '0:a?')
                if (useGpu) ovArgs.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23')
                else ovArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
                ovArgs.push('-c:a', 'copy', '-movflags', '+faststart', overlayOut)

                await runFF(ovArgs)
                currentFile = overlayOut
            }

            // â”€â”€ Interleave (REAL frame insertion via concat â€” not overlay) â”€â”€
            // Cuts video A at random points and inserts 2-3 frames from video B
            // Result: A_part1 + B_clip(0.1s) + A_part2 + B_clip(0.1s) + A_part3
            if (config.interleaveEnabled && config.interleaveFolderPath && fs.existsSync(config.interleaveFolderPath)) {
                // interleaveFolderPath is now a single video file path
                const ileaveVideos = [config.interleaveFolderPath]
                if (ileaveVideos.length > 0) {
                    try {
                        // Get video A duration via ffprobe
                        // execSync is imported at top of file
                        const durationStr = execSync(
                            `"${getFFprobePath()}" -v error -show_entries format=duration -of csv=p=0 "${currentFile}"`,
                            { timeout: 10000, encoding: 'utf-8', windowsHide: true }
                        ).trim()
                        const duration = parseFloat(durationStr) || 0

                        const warmup = config.interleaveWarmup || 5
                        const ratio = config.interleaveRatio || 5
                        const clipDuration = 0.1  // 3 frames at 30fps â€” imperceptible

                        if (duration > warmup + ratio) {
                            // Generate random cut points after warmup
                            const cutPoints: number[] = []
                            let t = warmup + Math.random() * (ratio * 0.3)
                            while (t < duration - 1) {
                                cutPoints.push(t)
                                t += ratio + (Math.random() - 0.5) * ratio * 0.3
                            }

                            if (cutPoints.length > 0) {
                                log(win, `ðŸ”€ Frame Interleave: inserting ${cutPoints.length} B-clips`)

                                // Extract B clips: 0.1s from random positions in random B videos
                                const bClips: string[] = []
                                for (let ci = 0; ci < cutPoints.length; ci++) {
                                    const bVideo = ileaveVideos[Math.floor(Math.random() * ileaveVideos.length)]
                                    const bClipPath = path.join(tmpDir, `b_clip_${ci}.mp4`)

                                    let bDur = 10
                                    try {
                                        const bDurStr = execSync(
                                            `"${getFFprobePath()}" -v error -show_entries format=duration -of csv=p=0 "${bVideo}"`,
                                            { timeout: 5000, encoding: 'utf-8', windowsHide: true }
                                        ).trim()
                                        bDur = parseFloat(bDurStr) || 10
                                    } catch {}

                                    const bStart = Math.max(0, Math.random() * (bDur - clipDuration - 1))
                                    await runFF(['-y', '-ss', bStart.toFixed(2), '-i', bVideo,
                                        '-t', clipDuration.toFixed(2),
                                        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
                                        '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
                                        bClipPath])
                                    if (fs.existsSync(bClipPath)) bClips.push(bClipPath)
                                }

                                if (bClips.length > 0) {
                                    // Cut A into segments, interleave with B clips
                                    const segments: string[] = []
                                    let prevCut = 0

                                    for (let ci = 0; ci < bClips.length; ci++) {
                                        const cutAt = cutPoints[ci]
                                        const segPath = path.join(tmpDir, `a_seg_${ci}.mp4`)
                                        await runFF(['-y', '-ss', prevCut.toFixed(2), '-i', currentFile,
                                            '-t', (cutAt - prevCut).toFixed(2),
                                            '-c', 'copy', '-movflags', '+faststart', segPath])
                                        if (fs.existsSync(segPath)) segments.push(segPath)
                                        segments.push(bClips[ci])
                                        prevCut = cutAt
                                    }

                                    // Final A segment
                                    const lastSeg = path.join(tmpDir, 'a_seg_final.mp4')
                                    await runFF(['-y', '-ss', prevCut.toFixed(2), '-i', currentFile,
                                        '-c', 'copy', '-movflags', '+faststart', lastSeg])
                                    if (fs.existsSync(lastSeg)) segments.push(lastSeg)

                                    // Concat all
                                    const concatFile = path.join(tmpDir, 'interleave_list.txt')
                                    fs.writeFileSync(concatFile,
                                        segments.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'), 'utf-8')

                                    const ileaveOut = path.join(tmpDir, 'interleave_out.mp4')
                                    await runFF(['-y', '-f', 'concat', '-safe', '0',
                                        '-i', concatFile, '-c', 'copy',
                                        '-movflags', '+faststart', ileaveOut])

                                    if (fs.existsSync(ileaveOut)) {
                                        currentFile = ileaveOut
                                        log(win, `âœ… Interleave: ${bClips.length} real B-clips inserted`)
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        log(win, `âš ï¸ Interleave error: ${e}`)
                    }
                }
            }

            // â”€â”€ Speed post-concat (BEFORE subtitle burn) â”€â”€
            // Applied here instead of per-chunk to avoid PTS drift at chunk boundaries.
            // Subtitles will be burned AFTER speed change â†’ ASS timestamps divided by speed.
            if (config.speed && config.speed !== 1.0) {
                log(win, `â© Applying speed ${config.speed}x...`)
                const speedOut = path.join(tmpDir, 'speed_out.mp4')
                const speedArgs = ['-y']
                if (useGpu) speedArgs.push('-hwaccel', 'cuda')
                speedArgs.push('-i', currentFile)
                speedArgs.push('-vf', `setpts=PTS/${config.speed.toFixed(3)}`)
                speedArgs.push('-af', `atempo=${config.speed.toFixed(3)}`)
                if (useGpu) speedArgs.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23')
                else speedArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
                speedArgs.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', speedOut)
                await runFF(speedArgs)
                currentFile = speedOut
            }

            // â”€â”€ Subtitle post-concat burn-in (with full ASS styling) â”€â”€
            // Burned AFTER speed change â†’ ASS timestamps = original_time / speed
            // Uses assGenerator.ts for 100% preview-export parity.
            if (config.srtPath && fs.existsSync(config.srtPath)) {
                log(win, `ðŸ“ Burning subtitles (styled ASS)...`)
                const subOut = path.join(tmpDir, 'sub_out.mp4')

                // Read SRT â†’ parse â†’ generate styled ASS
                const srtContent = fs.readFileSync(config.srtPath, 'utf-8')
                const segments = parseSrt(srtContent)

                const assContent = generateAssString({
                    segments,
                    style: (config.subStyle || 'bold_center') as SubStyle,
                    animation: (config.subAnimation || 'fade') as SubAnimation,
                    position: (config.subPosition || 'bottom') as SubPosition,
                    fontSize: config.subFontSize || 22,
                    previewHeight: config.previewHeight || 500,
                    offsetX: config.subOffsetX || 0,
                    offsetY: config.subOffsetY || 0,
                    playResX: 1080,
                    playResY: 1920,
                    // Don't pre-adjust ASS timestamps when speed post-process handles it
                    speed: needsSpeedPostProcess(config) ? 1.0 : (config.speed || 1.0),
                })

                // Write temp ASS file
                const tempAssPath = path.join(tmpDir, `sub_styled_${Date.now()}.ass`)
                fs.writeFileSync(tempAssPath, assContent, 'utf-8')

                // Resolve bundled fonts directory (public/fonts has all subtitle fonts)
                const appRoot = process.env.APP_ROOT || '.'
                const fontsDir = path.join(appRoot, 'public', 'fonts')
                const fontsDirEscaped = fontsDir
                    .replace(/\\/g, '/')
                    .replace(/:/g, '\\:')
                    .replace(/'/g, "\\'")

                const assEscaped = tempAssPath
                    .replace(/\\/g, '/')
                    .replace(/:/g, '\\:')
                    .replace(/'/g, "\\'")

                // Burn ASS with fontsdir so FFmpeg finds Montserrat/Poppins/Bangers
                const subArgs = ['-y']
                if (useGpu) subArgs.push('-hwaccel', 'cuda')
                subArgs.push('-i', currentFile)
                subArgs.push('-vf', `ass='${assEscaped}':fontsdir='${fontsDirEscaped}'`)
                if (useGpu) subArgs.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23')
                else subArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
                subArgs.push('-c:a', 'copy', '-movflags', '+faststart', subOut)

                await runFF(subArgs)
                currentFile = subOut
            }

            // â”€â”€ Remove audio if requested â”€â”€
            if (config.removeAudio) {
                log(win, `ðŸ”‡ Removing audio...`)
                const noAudioOut = path.join(tmpDir, 'noaudio_out.mp4')
                await runFF(['-y', '-i', currentFile, '-an', '-c:v', 'copy', '-movflags', '+faststart', noAudioOut])
                currentFile = noAudioOut
            }

            // â”€â”€ Move final result to output path â”€â”€
            if (currentFile !== outPath) {
                if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
                fs.copyFileSync(currentFile, outPath)
            }

        } finally {
            // â”€â”€ Phase 4: Cleanup temp â”€â”€
            try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* */ }
        }
    }

    // â”€â”€ Export single video with effects + optional SUB â”€â”€
    ipcMain.handle('reup:export', async (event, { config, outputPath }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'No window' }

        const inputPath = config.singleFile
        if (!inputPath || !fs.existsSync(inputPath)) {
            log(win, 'âŒ No video file to export')
            return { success: false, error: 'No video file' }
        }

        // Safety: check disk space before export
        try {
            const outRoot = path.parse(outputPath).root || 'C:\\'
            const driveLetter = outRoot.replace('\\', '')
            const { execSync: diskExec } = require('child_process')
            const wmicOut = diskExec(`wmic logicaldisk where "DeviceID='${driveLetter}'" get FreeSpace /format:value`, { encoding: 'utf-8', windowsHide: true })
            const match = wmicOut.match(/FreeSpace=(\d+)/)
            if (match) {
                const freeGB = parseInt(match[1]) / (1024 ** 3)
                if (freeGB < 2) {
                    log(win, '  Warning: Only ' + freeGB.toFixed(1) + ' GB free on output disk!')
                }
            }
        } catch { /* skip if wmic fails */ }

        let tempSrtPath = ''
        try {
            stopped = false
            const useGpu = await checkNvenc()

            // Copy SRT to temp with simple ASCII name (avoid Unicode path issues in FFmpeg filter)
            if (config.srtPath && fs.existsSync(config.srtPath)) {
                tempSrtPath = path.join(os.tmpdir(), `aurasplit_sub_${Date.now()}.srt`)
                fs.copyFileSync(config.srtPath, tempSrtPath)
                // Also copy word-timing JSON sidecar if it exists
                const wordsJsonSrc = config.srtPath + '.words.json'
                const wordsJsonDst = tempSrtPath + '.words.json'
                if (fs.existsSync(wordsJsonSrc)) {
                    fs.copyFileSync(wordsJsonSrc, wordsJsonDst)
                    ;(config as any).wordsJsonPath = wordsJsonDst
                    log(win, `ðŸ“ Word timing: ${path.basename(wordsJsonDst)}`)
                }
                config.srtPath = tempSrtPath
                log(win, `ðŸ“ Subtitles: ${path.basename(config.srtPath)}`)

                // Generate styled ASS file â€” SAME params as preview for guaranteed parity
                // Both preview & engine use identical: previewHeight=500, playRes=1080Ã—1920
                // PlayRes is resolution-independent: libass auto-scales to any render target.
                // Adding new styles/animations â†’ only edit assGenerator.ts, both paths match.
                const srtContent = fs.readFileSync(tempSrtPath, 'utf-8')
                const segments = parseSrt(srtContent)
                const assContent = generateAssString({
                    segments,
                    style: (config.subStyle || 'bold_center') as SubStyle,
                    animation: (config.subAnimation || 'fade') as SubAnimation,
                    position: (config.subPosition || 'bottom') as SubPosition,
                    fontSize: config.subFontSize || 22,
                    previewHeight: 500,
                    offsetX: config.subOffsetX || 0,
                    offsetY: config.subOffsetY || 0,
                    playResX: 1080,
                    playResY: 1920,
                    // When speed is applied as post-process (setpts+atempo AFTER render),
                    // ASS must NOT pre-adjust timestamps â€” the post-process shifts both
                    // video and burned subtitle together. Only adjust in ASS when speed
                    // is baked into the render itself (no post-process step).
                    speed: needsSpeedPostProcess(config) ? 1.0 : (config.speed || 1.0),
                })
                const tempAssPath = path.join(os.tmpdir(), `aurasplit_engine_${Date.now()}.ass`)
                fs.writeFileSync(tempAssPath, assContent, 'utf-8')
                ;(config as any)._engineAssPath = tempAssPath
                log(win, `ðŸ“ ASS styled: ${path.basename(tempAssPath)}`)
            }

            // Determine output path
            let outPath = outputPath
            if (!outPath) {
                const basename = path.basename(inputPath, path.extname(inputPath))
                const dir = path.dirname(inputPath)
                outPath = path.join(dir, `${basename}_REUP.mp4`)
            }

            const startTime = Date.now()

            // â”€â”€ Route: C++ Engine (simple) vs FFmpeg fastExport (full features) â”€â”€
            // Engine: fast decode/encode but MISSING subtitle burn, limited effects parity
            // fastExport: parallel encoding (3 chunks), full ASS subtitle burn, all effects
            const enginePath = getEnginePath()
            // Engine handles ALL features. Speed != 1.0 is applied as post-process (L1266)
            const hasHeavyFeatures = false

            if (enginePath && !hasHeavyFeatures) {
                log(win, `ðŸ”¥ C++ AuraEngine + CUDA GPU â†’ rendering...`)
                try {
                    const frameTemplate = config.frameTemplate || 'none'
                    const frameDimMap: Record<string, { w: number; h: number }> = {
                        '9:16': { w: 1080, h: 1920 },
                        '1:1': { w: 1080, h: 1080 },
                        '4:3': { w: 1440, h: 1080 },
                        '3:4': { w: 1080, h: 1440 },
                        '16:9': { w: 1920, h: 1080 },
                    }
                    const dims = frameDimMap[frameTemplate] || { w: 1080, h: 1920 }

                    await runEngine(enginePath, {
                        input: inputPath,
                        output: outPath,
                        width: dims.w,
                        height: dims.h,
                        gpu: useGpu,
                        speed: config.speed || 1.0,
                        mirror: config.mirror || false,
                        noise: !!config.noise,
                        noiseIntensity: typeof config.noise === 'number' ? config.noise : 10,
                        hdr: config.hdr || false,
                        glow: config.glow || false,
                        rgbDrift: config.rgbDrift || false,
                        lensDistortion: config.lensDistortion || false,
                        rotate: config.rotate || 0,
                        borderWidth: config.borderWidth || 0,
                        borderColor: config.borderColor || '#000000',
                        colorGrading: config.colorGrading || 'none',
                        zoomEffect: config.zoomEffect || false,
                        zoomIntensity: config.zoomIntensity || 1.0,
                        zoomPeriod: config.zoomPeriod || 16.0,
                        zoomPhase: config.zoomPhase || 0.0,
                        removeAudio: config.removeAudio || false,
                        cropX: config.cropX || 0,
                        cropY: config.cropY || 0,
                        crop: config.crop || 0,
                        // Reframe
                        reframeZoom: config.reframeZoom ?? 100,
                        reframeScaleX: config.reframeScaleX ?? 100,
                        reframeScaleY: config.reframeScaleY ?? 100,
                        reframePosX: config.reframePosX ?? 0,
                        reframePosY: config.reframePosY ?? 0,
                        // Pixel anti-detect
                        pixelEnlarge: config.pixelEnlarge || false,
                        chromaShuffle: config.chromaShuffle || false,
                        // BG Blur
                        bgBlur: !!(config.bgBlur && config.frameTemplate && config.frameTemplate !== 'none'),
                        bgBlurAmount: config.bgBlurAmount || 40,
                        // Logo
                        logoPath: config.logoPath || '',
                        logoSize: config.logoSize || 12,
                        logoPosition: config.logoPosition || 'bottom-right',
                        // Title
                        titleText: config.titleText || '',
                        descText: config.descText || '',
                        textFont: config.textFont || 'Inter',
                        textColor: config.textColor || '#ffffff',
                        titleFontSize: config.titleFontSize || 24,
                        descFontSize: config.descFontSize || 14,
                        titleOffsetX: config.titleOffsetX || 0,
                        titleOffsetY: config.titleOffsetY || 0,
                        descOffsetX: config.descOffsetX || 0,
                        descOffsetY: config.descOffsetY || 0,
                        // Subtitle â€” ASS file for preview-export parity
                        // Subtitle â€” handled by post-engine FFmpeg burn (not engine)
                        srtPath: '',
                        wordsJsonPath: '',
                        assPath: '',
                        fontsDir: (() => {
                            const appRoot = process.env.APP_ROOT || '.'
                            return path.join(appRoot, 'public', 'fonts')
                        })(),
                        subStyle: config.subStyle || 'bold_center',
                        subFontPath: (() => {
                            const appRoot = process.env.APP_ROOT || '.'
                            const fontMap: Record<string, string> = {
                                'Dancing Script': path.join(appRoot, 'fonts', 'DancingScript-Bold.ttf'),
                                'Pacifico': path.join(appRoot, 'fonts', 'Pacifico-Regular.ttf'),
                                'Lobster': path.join(appRoot, 'fonts', 'Lobster-Regular.ttf'),
                                'Sigmar One': path.join(appRoot, 'fonts', 'SigmarOne-Regular.ttf'),
                                'Bungee Shade': path.join(appRoot, 'fonts', 'BungeeShade-Regular.ttf'),
                                'Patrick Hand': path.join(appRoot, 'fonts', 'PatrickHand-Regular.ttf'),
                                'Dela Gothic One': path.join(appRoot, 'fonts', 'DelaGothicOne-Regular.ttf'),
                                'Fugaz One': path.join(appRoot, 'fonts', 'FugazOne-Regular.ttf'),
                                'Bangers': path.join(appRoot, 'fonts', 'Bangers-Regular.ttf'),
                                'Inter': path.join(appRoot, 'fonts', 'Inter-Bold.ttf'),
                                'Arial': 'C:/Windows/Fonts/arialbd.ttf',
                                'Impact': 'C:/Windows/Fonts/impact.ttf',
                            }
                            const userFont = config.textFont || 'Inter'
                            return fontMap[userFont] || path.join(appRoot, 'fonts', 'Inter-Bold.ttf')
                        })(),
                        subFontSize: config.subFontSize || 22,
                        subAnimation: config.subAnimation || 'fade',
                        subColor: config.textColor || '#ffffff',
                        subPosition: config.subPosition || 'bottom',
                        // Overlay
                        overlayPath: config.overlayPath || '',
                        overlayOpacity: config.overlayOpacity ?? 100,
                        overlayBlink: config.overlayBlink || false,
                        overlayBlinkSpeed: config.overlayBlinkSpeed || 1.0,
                        overlayInterval: config.overlayInterval || 3.0,
                        // Audio
                        audioEvade: config.audioEvade || false,
                        volumeBoost: config.volumeBoost || 1.0,
                        crf: 23,
                        preset: 'p1',
                        // Avfilter: engine CUDA handles ALL transforms + color effects.
                        // vFilterChain keeps ONLY drawbox (borders) and drawtext (titles)
                        // â€” the only effects engine can't do via CUDA.
                        // Everything else is stripped to prevent double processing
                        // (ghost layers from duplicate zoom/rotate/reframe/color).
                        vFilterChain: (() => {
                            const { vf } = buildFilterChain(config)
                            if (!vf) return ''
                            // WHITELIST: only keep drawbox and drawtext filters
                            return vf
                                .split(',')
                                .filter(f => f.startsWith('drawbox=') || f.startsWith('drawtext=') || f.startsWith('rgbashift='))
                                .join(',')
                        })(),
                    }, win)

                    // â”€â”€ Post-engine: Burn ASS subtitle via FFmpeg (reliable) â”€â”€
                    // Engine's libass subtitle burn is unreliable (font/animation issues).
                    // Use FFmpeg's ass filter instead â€” proven stable with fontsdir.
                    const engineAssPath = (config as any)._engineAssPath
                    if (engineAssPath && fs.existsSync(engineAssPath)) {
                        log(win, `ðŸ“ Burning subtitles via FFmpeg...`)
                        const tmpSub = outPath.replace(/\.mp4$/i, '_pre_sub.mp4')
                        fs.renameSync(outPath, tmpSub)

                        const appRoot = process.env.APP_ROOT || '.'
                        const subFontsDir = path.join(appRoot, 'public', 'fonts')
                        const assEsc = engineAssPath.replace(/\\/g, '/').replace(/:/g, '\\:')
                        const fontsEsc = subFontsDir.replace(/\\/g, '/').replace(/:/g, '\\:')

                        const subBurnArgs = ['-y']
                        if (useGpu) subBurnArgs.push('-hwaccel', 'cuda')
                        subBurnArgs.push('-i', tmpSub)
                        subBurnArgs.push('-vf', `ass='${assEsc}':fontsdir='${fontsEsc}'`)
                        if (useGpu) subBurnArgs.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23')
                        else subBurnArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
                        subBurnArgs.push('-c:a', 'copy', '-movflags', '+faststart', outPath)

                        await new Promise<void>((resolve, reject) => {
                            const proc = spawn(getFFmpegPath(), subBurnArgs, { windowsHide: true })
                            activeProcs.push(proc)
                            proc.stderr?.on('data', (d: Buffer) => {
                                const line = d.toString().trim()
                                if (line.includes('frame=')) {
                                    const m = line.match(/frame=\s*(\d+)/)
                                    if (m) log(win, `[SUB BURN] frame ${m[1]}`)
                                }
                            })
                            proc.on('close', (code) => {
                                activeProcs = activeProcs.filter(p => p !== proc)
                                if (code === 0) resolve()
                                else reject(new Error(`Subtitle burn FFmpeg failed (code ${code})`))
                            })
                            proc.on('error', reject)
                        })
                        try { fs.unlinkSync(tmpSub) } catch {}
                        log(win, `âœ… Subtitles burned`)
                    }

                    // â”€â”€ Post-engine: Overlay (video/image with opacity + blink) â”€â”€
                    if (config.overlayPath && fs.existsSync(config.overlayPath)) {
                        log(win, `ðŸŽ­ Applying overlay...`)
                        const tmpOverlay = outPath.replace(/\.mp4$/i, '_pre_overlay.mp4')
                        fs.renameSync(outPath, tmpOverlay)

                        const opacity = Math.pow((config.overlayOpacity || 60) / 100, 3)
                        const interval = config.overlayInterval || 0
                        const blinkSpeed = config.overlayBlinkSpeed || 0.1
                        let overlayFilter = ''

                        if (interval > 0 && config.overlayBlink) {
                            const cycle = interval * 2
                            const enableExpr = `lt(mod(t\\,${cycle})\\,${interval})*lt(mod(t\\,${blinkSpeed * 2})\\,${blinkSpeed})`
                            overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                                `[0:v][ov]overlay=0:0:enable='${enableExpr}'[v]`
                        } else if (interval > 0) {
                            const cycle = interval * 2
                            overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                                `[0:v][ov]overlay=0:0:enable='lt(mod(t\\,${cycle})\\,${interval})'[v]`
                        } else if (config.overlayBlink) {
                            overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                                `[0:v][ov]overlay=0:0:enable='lt(mod(t\\,${blinkSpeed * 2})\\,${blinkSpeed})'[v]`
                        } else {
                            overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[ov];` +
                                `[0:v][ov]overlay=0:0[v]`
                        }

                        const ffPath = getFFmpegPath()
                        const ovArgs = ['-y']
                        if (useGpu) ovArgs.push('-hwaccel', 'cuda')
                        ovArgs.push('-i', tmpOverlay, '-i', config.overlayPath)
                        ovArgs.push('-filter_complex', overlayFilter)
                        ovArgs.push('-map', '[v]', '-map', '0:a?')
                        if (useGpu) ovArgs.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23')
                        else ovArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
                        ovArgs.push('-c:a', 'copy', '-movflags', '+faststart', outPath)

                        await new Promise<void>((resolve, reject) => {
                            const proc = spawn(ffPath, ovArgs, { windowsHide: true })
                            activeProcs.push(proc)
                            proc.stderr?.on('data', (d: Buffer) => {
                                const line = d.toString().trim()
                                if (line.includes('frame=')) {
                                    const m = line.match(/frame=\s*(\d+)/)
                                    if (m) log(win, `[OVERLAY] frame ${m[1]}`)
                                }
                            })
                            proc.on('close', (code) => {
                                activeProcs = activeProcs.filter(p => p !== proc)
                                if (code === 0) resolve()
                                else reject(new Error(`Overlay FFmpeg failed (code ${code})`))
                            })
                            proc.on('error', reject)
                        })

                        // Cleanup temp file
                        try { fs.unlinkSync(tmpOverlay) } catch { /* */ }
                        log(win, `âœ… Overlay applied`)
                    }

                    // â”€â”€ Post-engine: Frame Interleave (real frame insertion) â”€â”€

                    if (config.interleaveEnabled && config.interleaveFolderPath && fs.existsSync(config.interleaveFolderPath)) {
                        // interleaveFolderPath is now a single video file path
                        const ileaveVideos = [config.interleaveFolderPath]

                        if (ileaveVideos.length > 0) {
                            try {
                                const durStr = execSync(
                                    `"${getFFprobePath()}" -v error -show_entries format=duration -of csv=p=0 "${outPath}"`,
                                    { timeout: 10000, encoding: 'utf-8', windowsHide: true }
                                ).trim()
                                const dur = parseFloat(durStr) || 0
                                const warmup = config.interleaveWarmup || 5
                                const ratio = config.interleaveRatio || 5
                                // const clipDur = 0.1  // reserved for future frame-level interleave


                                if (dur > warmup + ratio) {
                                    let cuts: number[] = []
                                    let ct = warmup + Math.random() * (ratio * 0.3)
                                    while (ct < dur - 1) {
                                        cuts.push(ct)
                                        ct += ratio + (Math.random() - 0.5) * ratio * 0.3
                                    }
                                    // Cap at 5 insertions max â€” pick random ones for speed
                                    if (cuts.length > 5) {
                                        cuts.sort(() => Math.random() - 0.5)
                                        cuts = cuts.slice(0, 5).sort((a, b) => a - b)
                                    }


                                    if (cuts.length > 0) {
                                        log(win, `ðŸ”€ Frame Interleave: ${cuts.length} points (capped at 5)`)
                                        const tmpDir2 = path.join(path.dirname(outPath), '.tmp_interleave')
                                        fs.mkdirSync(tmpDir2, { recursive: true })
                                        const ff = getFFmpegPath()

                                        // Create BLENDED frames: 97% A + 3% B â†’ invisible but breaks Content ID
                                        const blendClips: string[] = []
                                        for (let ci = 0; ci < cuts.length; ci++) {
                                            const bVid = ileaveVideos[Math.floor(Math.random() * ileaveVideos.length)]
                                            let bDur2 = 10
                                            try {
                                                bDur2 = parseFloat(execSync(
                                                    `"${getFFprobePath()}" -v error -show_entries format=duration -of csv=p=0 "${bVid}"`,
                                                    { timeout: 5000, encoding: 'utf-8', windowsHide: true }
                                                ).trim()) || 10
                                            } catch {}
                                            const bSt = Math.max(0, Math.random() * (bDur2 - 1))
                                            const cutT = cuts[ci]

                                            // Extract 1 frame from A at cut point
                                            const aFrame = path.join(tmpDir2, `af_${ci}.png`)
                                            try { execSync(`"${ff}" -y -ss ${cutT.toFixed(2)} -i "${outPath}" -frames:v 1 "${aFrame}"`, { timeout: 15000, windowsHide: true }) } catch {}

                                            // Extract 1 frame from B
                                            const bFrame = path.join(tmpDir2, `bf_${ci}.png`)
                                            try { execSync(`"${ff}" -y -ss ${bSt.toFixed(2)} -i "${bVid}" -frames:v 1 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" "${bFrame}"`, { timeout: 15000, windowsHide: true }) } catch {}

                                            // Blend: 70% A + 30% B â†’ TEST MODE (change back to 0.03 for production)
                                            const blendFrame = path.join(tmpDir2, `blend_${ci}.png`)
                                            if (fs.existsSync(aFrame) && fs.existsSync(bFrame)) {
                                                try {
                                                    execSync(`"${ff}" -y -i "${aFrame}" -i "${bFrame}" -filter_complex "[1:v]format=rgba,colorchannelmixer=aa=0.30[b];[0:v][b]overlay=(W-w)/2:(H-h)/2" -frames:v 1 "${blendFrame}"`, { timeout: 15000, windowsHide: true })
                                                } catch {}
                                            }

                                            // Create 1-frame mp4 (0.033s at 30fps)
                                            const blendClip = path.join(tmpDir2, `bc_${ci}.mp4`)
                                            const srcFrame = fs.existsSync(blendFrame) ? blendFrame : aFrame
                                            if (fs.existsSync(srcFrame)) {
                                                try {
                                                    execSync(`"${ff}" -y -loop 1 -i "${srcFrame}" -t 0.033 -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p -r 30 "${blendClip}"`, { timeout: 15000, windowsHide: true })
                                                } catch {}
                                            }
                                            if (fs.existsSync(blendClip)) blendClips.push(blendClip)
                                            log(win, `  ðŸ”¬ Stealth frame ${ci + 1}/${cuts.length}`)
                                        }

                                        if (blendClips.length > 0) {
                                            const segs: string[] = []
                                            let prev = 0

                                            // Cut A into segments, insert blended frames
                                            for (let ci = 0; ci < blendClips.length; ci++) {
                                                const segP = path.join(tmpDir2, `a_${ci}.mp4`)
                                                try {
                                                    execSync(`"${ff}" -y -ss ${prev.toFixed(2)} -i "${outPath}" -t ${(cuts[ci] - prev).toFixed(2)} -c copy -movflags +faststart "${segP}"`, { timeout: 60000, windowsHide: true })
                                                } catch (e) { console.error(`[IL] A-seg ${ci} fail:`, e) }
                                                if (fs.existsSync(segP)) segs.push(segP)
                                                segs.push(blendClips[ci])
                                                prev = cuts[ci]
                                            }

                                            // Final A segment
                                            const lastP = path.join(tmpDir2, 'a_last.mp4')
                                            try {
                                                execSync(`"${ff}" -y -ss ${prev.toFixed(2)} -i "${outPath}" -c copy -movflags +faststart "${lastP}"`, { timeout: 60000, windowsHide: true })
                                            } catch (e) { console.error(`[IL] Last seg fail:`, e) }
                                            if (fs.existsSync(lastP)) segs.push(lastP)

                                            // Concat all
                                            const listFile = path.join(tmpDir2, 'concat.txt')
                                            fs.writeFileSync(listFile, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'), 'utf-8')
                                            const ilOut = outPath.replace(/\.mp4$/i, '_interleaved.mp4')
                                            try {
                                                execSync(`"${ff}" -y -fflags +genpts -f concat -safe 0 -i "${listFile}" -c copy -movflags +faststart "${ilOut}"`, { timeout: 60000, windowsHide: true })
                                            } catch (e) { console.error(`[IL] Concat fail:`, e) }

                                            if (fs.existsSync(ilOut)) {
                                                fs.unlinkSync(outPath)
                                                fs.renameSync(ilOut, outPath)
                                                log(win, `âœ… Stealth Interleave: ${blendClips.length} invisible frames inserted`)
                                            }
                                        }

                                        // Cleanup
                                        try { fs.rmSync(tmpDir2, { recursive: true, force: true }) } catch {}
                                    }
                                }
                            } catch (e) {
                                console.error(`[INTERLEAVE-ERROR]`, e)
                                log(win, `âš ï¸ Interleave error: ${e}`)
                            }
                        }
                    }

                    // â”€â”€ Post-engine: Speed change (setpts + atempo) â”€â”€
                    if (needsSpeedPostProcess(config)) {
                        log(win, `âš¡ Applying speed ${config.speed}x...`)
                        const tmpSpeed = outPath.replace(/\.mp4$/i, '_pre_speed.mp4')
                        fs.renameSync(outPath, tmpSpeed)
                        const speedArgs = ['-y', '-i', tmpSpeed,
                            '-vf', `setpts=PTS/${config.speed.toFixed(3)}`,
                            '-af', `atempo=${config.speed.toFixed(3)}`,
                            '-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23',
                            '-c:a', 'aac', '-b:a', '192k',
                            '-movflags', '+faststart', outPath]
                        await new Promise<void>((resolve, reject) => {
                            const proc = spawn(getFFmpegPath(), speedArgs, { windowsHide: true })
                            proc.stderr?.on('data', (d: Buffer) => {
                                const line = d.toString()
                                if (line.includes('frame=')) {
                                    const m = line.match(/frame=\s*(\d+)/)
                                    if (m) log(win, `[SPEED] frame ${m[1]}`)
                                }
                            })
                            proc.on('close', (code) => {
                                if (code === 0) resolve()
                                else reject(new Error(`Speed FFmpeg failed (code ${code})`))
                            })
                            proc.on('error', reject)
                        })
                        try { fs.unlinkSync(tmpSpeed) } catch { /* */ }
                        log(win, `âœ… Speed ${config.speed}x applied`)
                    }

                    // â”€â”€ Post-engine: Audio evade (volume boost / pitch shift / audio effects) â”€â”€
                    if (needsSeparateAudio(config)) {
                        log(win, `ðŸ”Š Applying audio evade...`)
                        const tmpAudioSrc = outPath.replace(/\.mp4$/i, '_pre_audio.mp4')
                        fs.renameSync(outPath, tmpAudioSrc)

                        // Extract + process audio with FFmpeg
                        const tmpAudio = outPath.replace(/\.mp4$/i, '_audio.aac')
                        const { af } = buildFilterChain(config)
                        const audioArgs = ['-y', '-i', tmpAudioSrc]
                        if (af) audioArgs.push('-af', af)
                        audioArgs.push('-vn', '-c:a', 'aac', '-b:a', '192k', tmpAudio)
                        await new Promise<void>((resolve, reject) => {
                            const proc = spawn(getFFmpegPath(), audioArgs, { windowsHide: true })
                            proc.on('close', (code) => {
                                if (code === 0) resolve()
                                else reject(new Error(`Audio extract failed (code ${code})`))
                            })
                            proc.on('error', reject)
                        })

                        // Mux video (copy) + processed audio
                        await new Promise<void>((resolve, reject) => {
                            const proc = spawn(getFFmpegPath(), ['-y',
                                '-i', tmpAudioSrc, '-i', tmpAudio,
                                '-c:v', 'copy', '-c:a', 'copy',
                                '-map', '0:v:0', '-map', '1:a:0',
                                '-movflags', '+faststart', outPath], { windowsHide: true })
                            proc.on('close', (code) => {
                                if (code === 0) resolve()
                                else reject(new Error(`Audio mux failed (code ${code})`))
                            })
                            proc.on('error', reject)
                        })

                        try { fs.unlinkSync(tmpAudioSrc) } catch { /* */ }
                        try { fs.unlinkSync(tmpAudio) } catch { /* */ }
                        log(win, `âœ… Audio evade applied`)
                    }

                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
                    log(win, `âœ… C++ Engine exported in ${elapsed}s: ${outPath}`)
                    return { success: true, outputPath: outPath }
                } catch (e: any) {
                    console.error(`[EXPORT] Engine failed, using FFmpeg`)
                    log(win, `âš ï¸ Engine failed â†’ fallback to FFmpeg: ${e.message}`)
                }
            } else {

                log(win, `â„¹ï¸ C++ Engine not found â†’ using FFmpeg`)
            }


            log(win, useGpu ? 'ðŸš€ GPU (NVENC) + Split&Stitch' : 'ðŸ’» CPU + Split&Stitch')
            log(win, `ðŸ“¦ Exporting: ${path.basename(inputPath)}`)
            await fastExport(inputPath, outPath, config, useGpu, win)
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

            log(win, `âœ… Exported in ${elapsed}s: ${outPath}`)
            return { success: true, outputPath: outPath }
        } catch (e: any) {
            log(win, `âŒ Export failed: ${e.message}`)
            return { success: false, error: e.message }
        } finally {
            // Cleanup temp SRT
            if (tempSrtPath) try { fs.unlinkSync(tempSrtPath) } catch { /* */ }
        }
    })

    // â”€â”€ Device Profiles: match encoder params â†” metadata (Gemini's insight) â”€â”€
    const DEVICE_PROFILES = [
        { id: 'iphone15pro', name: 'iPhone 15 Pro Max', make: 'Apple', software: '17.4.1', handler: 'Core Media Video' },
        { id: 'iphone15', name: 'iPhone 15', make: 'Apple', software: '17.3.1', handler: 'Core Media Video' },
        { id: 'iphone14', name: 'iPhone 14', make: 'Apple', software: '16.7.2', handler: 'Core Media Video' },
        { id: 'iphone13', name: 'iPhone 13', make: 'Apple', software: '16.6.1', handler: 'Core Media Video' },
        { id: 'samsung_s24', name: 'Samsung Galaxy S24', make: 'Samsung', software: 'Android 14', handler: 'VideoHandle' },
        { id: 'samsung_s23', name: 'Samsung Galaxy S23', make: 'Samsung', software: 'Android 13', handler: 'VideoHandle' },
        { id: 'generic', name: 'Generic', make: '', software: '', handler: '' },
    ] as const

    // â”€â”€ Randomize all effect parameters for anti-detection â”€â”€
    const COLOR_GRADING_STYLES: ColorGradingStyle[] = ['none', 'vibrant', 'bw', 'sepia', 'cool_blue']

    function randomizeConfig(baseConfig: ReupConfig): ReupConfig {
        const rand = (min: number, max: number) => min + Math.random() * (max - min)
        const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1))
        const randBool = (chance = 0.5) => Math.random() < chance
        const randPick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

        const device = randPick(DEVICE_PROFILES)

        const cfg: ReupConfig = {
            ...baseConfig,
            // Speed: 1.0-1.03 (imperceptible)
            speed: parseFloat(rand(1.0, 1.03).toFixed(3)),
            // Mirror: 50% chance
            mirror: randBool(0.5),
            // Crop: tiny random crop 0.005-0.015 (imperceptible)
            crop: parseFloat(rand(0.005, 0.015).toFixed(3)),
            cropX: parseFloat(rand(0.003, 0.01).toFixed(3)),
            cropY: parseFloat(rand(0.003, 0.01).toFixed(3)),
            // Noise: ultra-subtle 1-3
            noise: randInt(1, 3),
            // Rotate: 0.1-0.3 degrees (truly invisible)
            rotate: parseFloat(rand(0.1, 0.3).toFixed(2)),
            // Lens Distortion: 70% chance
            lensDistortion: randBool(0.7),
            // HDR: 60% chance
            hdr: randBool(0.6),
            // Color Grading: random style
            colorGrading: randPick(COLOR_GRADING_STYLES),
            // Glow OR RGB Drift â€” NEVER both (prevents border stacking)
            glow: false as boolean,  // will set below
            // Border: 1px
            borderWidth: 1,
            borderColor: '#000000',
            // Pixel-level anti-detect â€” random INTENSITY per video (0-100)
            pixelEnlarge: randBool(0.5) ? randInt(30, 80) : 0,
            chromaShuffle: randBool(0.4) ? randInt(20, 70) : 0,
            rgbDrift: false as boolean, // will set below
            // Advanced anti-detect â€” random INTENSITY per video
            frameJitter: randBool(0.4) ? randInt(15, 50) : 0,  // NOW ENABLED at low intensity!
            gammaShift: randBool(0.65) ? randInt(25, 75) : 0,
            microColorCycle: randBool(0.7) ? randInt(20, 65) : 0,
            dctNoise: randBool(0.6) ? randInt(20, 60) : 0,
            // â”€â”€ NEW: Anti-detect arsenal â”€â”€
            hueShift: randInt(1, 3),
            microZoom: parseFloat(rand(1.01, 1.03).toFixed(3)),
            zoomPeriod: parseFloat(rand(10.0, 25.0).toFixed(2)),
            zoomPhase: parseFloat(rand(0.0, Math.PI * 2).toFixed(3)),
            zoomIntensity: baseConfig.zoomEffect ? parseFloat(rand(Math.max(1.02, baseConfig.zoomIntensity - 0.05), baseConfig.zoomIntensity + 0.1).toFixed(3)) : 1.0,
            fadeInOut: parseFloat(rand(0.2, 0.5).toFixed(2)),
            ptsJitter: false,  // disabled â€” causes visible stutter
            microTempo: parseFloat(rand(1.005, 1.015).toFixed(4)),
            deviceProfile: device.id,
            // Audio evade: always on
            audioEvade: true,
            pitchShift: true,
            // Volume boost: slight random
            volumeBoost: parseFloat(rand(0.95, 1.05).toFixed(2)),
            // NEW: Brightness/Contrast/Saturation/Vignette/ColorTemp
            brightnessShift: parseFloat(rand(-0.02, 0.02).toFixed(3)),
            contrastShift: parseFloat(rand(0.98, 1.02).toFixed(3)),
            saturationShift: parseFloat(rand(0.95, 1.05).toFixed(2)),
            vignette: randBool(0.3),
            colorTemp: randPick(['warm', 'cool', 'none', 'none']),
            // Clean metadata: always
            cleanMetadata: true,
            // Reframe: keep at 100
            reframeZoom: 100, reframeScaleX: 100, reframeScaleY: 100,
            reframePosX: 0, reframePosY: 0,
            // BG Blur: keep from base
            bgBlur: baseConfig.bgBlur ?? true,
            bgBlurAmount: baseConfig.bgBlurAmount ?? 40,
        }
        // Glow OR RGB Drift â€” mutually exclusive (never stack borders)
        const borderRoll = Math.random()
        if (borderRoll < 0.4) cfg.glow = true
        else if (borderRoll < 0.8) cfg.rgbDrift = true
        // else: neither (20% chance = clean edges)
        return cfg
    }

    /** Inject fake device metadata into exported video (replaces -map_metadata -1) */
    async function injectFakeMetadata(videoPath: string, deviceId?: string): Promise<void> {
        const device = DEVICE_PROFILES.find(d => d.id === deviceId) || DEVICE_PROFILES[DEVICE_PROFILES.length - 1]
        if (device.id === 'generic') return


        // Random creation date: 1-30 days ago, 6:00-22:00
        const daysAgo = Math.floor(Math.random() * 30) + 1
        const hour = Math.floor(Math.random() * 16) + 6
        const minute = Math.floor(Math.random() * 60)
        const second = Math.floor(Math.random() * 60)
        const date = new Date()
        date.setDate(date.getDate() - daysAgo)
        date.setHours(hour, minute, second, 0)
        const isoDate = date.toISOString().replace(/\.\d{3}Z$/, '.000000Z')

        const tmpPath = videoPath.replace(/\.mp4$/i, '_meta.mp4')
        const args = [
            '-i', videoPath,
            '-map_metadata', '-1',
            '-c', 'copy',
            '-metadata', `creation_time=${isoDate}`,
            '-metadata', `com.apple.quicktime.make=${device.make}`,
            '-metadata', `com.apple.quicktime.model=${device.name}`,
            '-metadata', `com.apple.quicktime.software=${device.software}`,
            '-metadata', `com.apple.quicktime.creationdate=${isoDate}`,
            '-metadata:s:v:0', `handler_name=${device.handler}`,
            '-movflags', '+faststart',
            '-loglevel', 'error',
            tmpPath
        ]
        try {
            await runFF(args)
            // Replace original with metadata version
            fs.unlinkSync(videoPath)
            fs.renameSync(tmpPath, videoPath)
        } catch (e) {
            // Cleanup temp if failed
            try { fs.unlinkSync(tmpPath) } catch { /* */ }
            console.warn('[META] Failed to inject metadata:', e)
        }
    }

    /** Append random bytes to MP4 for unique file hash (players ignore trailing data) */
    function appendUniqueHash(videoPath: string): void {
        try {
            const randomBytes = crypto.randomBytes(Math.floor(Math.random() * 48) + 16)
            fs.appendFileSync(videoPath, randomBytes)

        } catch (e) {
            console.warn('[HASH] Failed to append unique hash:', e)
        }
    }

    // â”€â”€ Auto Pipeline: [Split â†’] Random â†’ Export â†’ Clean Metadata â”€â”€
    ipcMain.handle('reup:autoPipeline', async (event, { folderPath, outputDir, baseConfig, inputPath, splitDuration }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'No window' }

        try {
            stopped = false
            let clipFolder = folderPath

            // Step 0: Auto-split if inputPath + splitDuration provided
            if (inputPath && splitDuration && fs.existsSync(inputPath)) {
                const basename = path.basename(inputPath, path.extname(inputPath))
                clipFolder = path.join(path.dirname(inputPath), `${basename}_Parts`)
                fs.mkdirSync(clipFolder, { recursive: true })

                const duration = await getVideoDuration(inputPath)
                const numParts = Math.max(1, Math.ceil(duration / splitDuration))
                log(win, `âœ‚ï¸ Auto Split: "${basename}" â†’ ${numParts} parts (${splitDuration}s each)`)

                for (let i = 0; i < numParts; i++) {
                    if (stopped) throw new Error('Stopped')
                    const start = i * splitDuration
                    const partLen = Math.min(splitDuration, duration - start)
                    if (partLen < 0.1) break

                    const partName = `${basename}_Part${String(i + 1).padStart(2, '0')}.mp4`
                    const partPath = path.join(clipFolder, partName)

                    await runFF([
                        '-y', '-ss', String(start),
                        '-i', inputPath,
                        '-t', String(partLen),
                        '-c', 'copy', '-avoid_negative_ts', '1',
                        '-movflags', '+faststart', partPath,
                    ])
                    log(win, `  [${i + 1}/${numParts}] âœ… ${partName}`)
                }
                log(win, `âœ… Split complete â†’ ${clipFolder}`)
            }

            // 1. Scan folder for video files, sort by name (Part01, Part02...)
            const videos = listVideos(clipFolder).sort()
            if (videos.length === 0) {
                log(win, 'âŒ No videos found in folder')
                return { success: false, error: 'No videos in folder' }
            }

            // Create output directory
            const outDir = outputDir || path.join(clipFolder, 'exported')
            fs.mkdirSync(outDir, { recursive: true })

            log(win, `ðŸŽ² Auto Pipeline: ${videos.length} clips â†’ random effects â†’ export`)
            log(win, `ðŸ“ Input: ${folderPath}`)
            log(win, `ðŸ“ Output: ${outDir}`)

            const _useGpu = await checkNvenc()
            void _useGpu  // reserved for future GPU-specific pipeline selection
            let doneCount = 0
            const results: { file: string; success: boolean; time: number }[] = []

            // 2. Process clips in PARALLEL batches (each clip uses 3 parallel chunks internally)
            const PARALLEL_CLIPS = 2
            for (let batchStart = 0; batchStart < videos.length; batchStart += PARALLEL_CLIPS) {
                if (stopped) break
                const batch = videos.slice(batchStart, batchStart + PARALLEL_CLIPS)

                const batchPromises = batch.map(async (videoPath: string, batchIdx: number) => {
                if (stopped) return
                const idx = batchStart + batchIdx
                const clipName = path.basename(videoPath, path.extname(videoPath))
                const outPath = path.join(outDir, `${clipName}_reup.mp4`)

                const randomConfig = randomizeConfig({
                    ...baseConfig,
                    singleFile: videoPath,
                    inputFolder: clipFolder,
                })

                log(win, `\n[${idx + 1}/${videos.length}] ðŸŽ¬ ${clipName}`)

                const clipStart = Date.now()
                try {
                    const enginePath = getEnginePath()
                    if (!enginePath) throw new Error('Engine not found')
                    await runEngine(enginePath, buildEngineConfig(videoPath, outPath, randomConfig), win)
                    // â”€â”€ Post-export anti-detect: metadata + file hash â”€â”€
                    await injectFakeMetadata(outPath, randomConfig.deviceProfile)
                    appendUniqueHash(outPath)
                    const elapsed = ((Date.now() - clipStart) / 1000).toFixed(1)
                    log(win, `  âœ… ${path.basename(outPath)} (${elapsed}s)`)
                    results.push({ file: clipName, success: true, time: parseFloat(elapsed) })
                } catch (err: any) {
                    log(win, `  âŒ Failed: ${err.message}`)
                    results.push({ file: clipName, success: false, time: 0 })
                }

                doneCount++
                win.webContents.send('reup:autoPipelineProgress', {
                    current: doneCount,
                    total: videos.length,
                    clipName,
                })
                }) // end batch.map

                await Promise.all(batchPromises)
            }

            // 3. Final step: Clean metadata + fake iPhone metadata on ALL exported files
            if (!stopped) {

                const iphoneModels = [
                    { model: 'iPhone 15 Pro Max', ios: '17.4' },
                    { model: 'iPhone 15 Pro', ios: '17.3' },
                    { model: 'iPhone 15', ios: '17.2' },
                    { model: 'iPhone 14 Pro Max', ios: '17.1' },
                    { model: 'iPhone 14 Pro', ios: '16.7' },
                    { model: 'iPhone 13 Pro', ios: '16.5' },
                ]

                const exportedFiles = results.filter(r => r.success).map(r => {
                    return path.join(outDir, `${r.file}_reup.mp4`)
                })

                for (const filePath of exportedFiles) {
                    if (!fs.existsSync(filePath)) continue
                    const pick = iphoneModels[Math.floor(Math.random() * iphoneModels.length)]
                    const daysAgo = Math.floor(Math.random() * 30) + 1
                    const date = new Date(Date.now() - daysAgo * 86400000)
                    date.setHours(8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60))
                    const creationTime = date.toISOString().replace(/\.\d{3}Z$/, '+07:00')

                    const tmpClean = filePath.replace(/\.mp4$/i, '_clean.mp4')
                    try {
                        await runFF([
                            '-y', '-i', filePath,
                            '-c', 'copy',
                            '-map_metadata', '-1',
                            '-fflags', '+bitexact',
                            '-metadata', `make=Apple`,
                            '-metadata', `model=${pick.model}`,
                            '-metadata', `encoder=Apple iOS ${pick.ios}`,
                            '-metadata', `creation_time=${creationTime}`,
                            '-metadata', 'title=Recorded by iPhone',
                            '-metadata', 'comment=Shot on iPhone',
                            '-movflags', '+faststart',
                            tmpClean,
                        ])
                        // Replace original with clean version
                        fs.unlinkSync(filePath)
                        fs.renameSync(tmpClean, filePath)

                    } catch {
                        log(win, `  âš ï¸ Metadata clean failed: ${path.basename(filePath)}`)
                        try { fs.unlinkSync(tmpClean) } catch { /* */ }
                    }
                }
                log(win, `âœ… Metadata cleaned: ${exportedFiles.length} files`)
            }

            // Summary
            const totalTime = results.reduce((s, r) => s + r.time, 0).toFixed(1)
            const successCount = results.filter(r => r.success).length
            log(win, `\nâœ… Auto Pipeline complete: ${successCount}/${videos.length} clips in ${totalTime}s`)

            return { success: true, results, totalTime: parseFloat(totalTime) }
        } catch (e: any) {
            log(win, `âŒ Auto Pipeline failed: ${e.message}`)
            return { success: false, error: e.message }
        }
    })

    // â”€â”€ Split Part: Chia video thÃ nh nhiá»u pháº§n theo duration â”€â”€

    // â•â• Shuffle Pipeline â•â•

    function shuffleArray<T>(arr: T[]): T[] {
        const a = [...arr]
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[a[i], a[j]] = [a[j], a[i]]
        }
        return a
    }

    async function groupClipsByDuration(clips: string[], targetSec: number): Promise<string[][]> {
        const groups: string[][] = []
        let current: string[] = []
        let currentDur = 0
        for (const clip of clips) {
            const dur = await getVideoDuration(clip)
            current.push(clip)
            currentDur += dur
            if (currentDur >= targetSec) {
                groups.push(current)
                current = []
                currentDur = 0
            }
        }
        if (current.length > 0) groups.push(current)
        return groups
    }

    ipcMain.handle('reup:shufflePipeline', async (event, {
        parentFolder, targetDuration, deleteOriginals, baseConfig,
    }: { parentFolder: string; targetDuration: number; deleteOriginals: boolean; baseConfig: any }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'No window' }

        try {
            stopped = false
            const useGpu = await checkNvenc()

            const entries = fs.readdirSync(parentFolder)
            const subfolders: string[] = entries
                .map((e: string) => path.join(parentFolder, e))
                .filter((p: string) => {
                    try { return fs.statSync(p).isDirectory() } catch { return false }
                })
                .filter((p: string) => listVideos(p).length > 0)

            if (subfolders.length === 0) {
                const directVids = listVideos(parentFolder)
                if (directVids.length > 0) {
                    subfolders.push(parentFolder)
                } else {
                    return { success: false, error: 'No subfolders with videos found' }
                }
            }

            log(win, '\nðŸ”€ Shuffle Pipeline: ' + subfolders.length + ' folders')
            let totalFinals = 0

            for (const subPath of subfolders) {
                if (stopped) break
                const subName = path.basename(subPath)
                const clips = listVideos(subPath).sort()
                log(win, '\nðŸ“ ' + subName + ': ' + clips.length + ' clips')

                const shuffled = shuffleArray(clips)
                log(win, '  ðŸ”€ Shuffled: ' + shuffled.map((c: string) => path.basename(c)).join(', '))

                const groups = await groupClipsByDuration(shuffled, targetDuration || 60)
                log(win, '  ðŸ“¦ ' + groups.length + ' groups (~' + (targetDuration || 60) + 's each)')

                const outDir = path.join(subPath, 'exported')
                fs.mkdirSync(outDir, { recursive: true })

                for (let g = 0; g < groups.length; g++) {
                    if (stopped) break
                    const group = groups[g]
                    const finalName = subName + '_FINAL_' + String(g + 1).padStart(2, '0') + '.mp4'
                    const finalPath = path.join(outDir, finalName)

                    log(win, '\n  [Group ' + (g + 1) + '/' + groups.length + '] ' + group.length + ' clips')

                    const tmpDir = path.join(outDir, '.tmp_' + Date.now() + '_' + g)
                    fs.mkdirSync(tmpDir, { recursive: true })

                    const processedClips: string[] = []
                    for (let c = 0; c < group.length; c++) {
                        const clip = group[c]
                        const shouldMirror = Math.random() > 0.5
                        const tmpClip = path.join(tmpDir, 'clip_' + String(c).padStart(3, '0') + '.mp4')

                        if (shouldMirror) {
                            await runFF(['-y', '-i', clip, '-vf', 'hflip',
                                '-c:v', useGpu ? 'h264_nvenc' : 'libx264',
                                '-preset', useGpu ? 'p1' : 'ultrafast',
                                '-cq', '20', '-c:a', 'copy',
                                '-movflags', '+faststart', tmpClip])
                            log(win, '    â†”ï¸ ' + path.basename(clip) + ' (mirrored)')
                        } else {
                            await runFF(['-y', '-i', clip, '-c', 'copy', '-movflags', '+faststart', tmpClip])
                            log(win, '    âœ… ' + path.basename(clip))
                        }
                        processedClips.push(tmpClip)
                    }

                    const concatList = path.join(tmpDir, 'concat.txt')
                    const concatContent = processedClips.map((p: string) => "file '" + p.replace(/\\/g, '/') + "'").join('\n')
                    fs.writeFileSync(concatList, concatContent, 'utf-8')

                    const mergedPath = path.join(tmpDir, 'merged.mp4')
                    await runFF(['-y', '-f', 'concat', '-safe', '0', '-i', concatList,
                        '-c', 'copy', '-movflags', '+faststart', mergedPath])
                    log(win, '    ðŸ“Ž Merged ' + processedClips.length + ' clips')

                    const randomConfig = randomizeConfig({ ...baseConfig, singleFile: mergedPath, inputFolder: tmpDir })
                    const enginePath = getEnginePath()
                    if (enginePath) {
                        // Use user's selected frame template for output dimensions
                        const frameDimMap: Record<string, { w: number; h: number }> = {
                            '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 },
                            '16:9': { w: 1920, h: 1080 }, '4:3': { w: 1440, h: 1080 }, '3:4': { w: 1080, h: 1440 },
                        }
                        const userFrame = baseConfig.frameTemplate || 'none'
                        let dims = frameDimMap[userFrame] || { w: 1920, h: 1080 }
                        // If 'none', auto-detect from source video
                        if (userFrame === 'none') {
                            try {
                                const probeArgs = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mergedPath]
                                const probeResult = await new Promise<string>((resolve, reject) => {
                                    const p = spawn(getFFprobePath(), probeArgs, { windowsHide: true })
                                    let out = ''
                                    p.stdout?.on('data', (d: Buffer) => { out += d.toString() })
                                    p.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error('ffprobe failed')))
                                    p.on('error', reject)
                                })
                                const [w, h] = probeResult.split(',').map(Number)
                                if (w > 0 && h > 0) dims = { w, h }
                            } catch { /* keep default */ }
                        }
                        log(win, `    ðŸŽ¬ Output: ${dims.w}x${dims.h} (${userFrame})`)
                        const { vf } = buildFilterChain(randomConfig)
                        const _vFilterChain = vf ? vf.split(',').filter((f: string) => !f.startsWith('format=')).join(',') : ''
                        void _vFilterChain  // reserved for NVEncC fallback path

                        try {
                            await runEngine(enginePath, buildEngineConfig(mergedPath, finalPath, randomConfig), win)
                            log(win, '    ðŸŽ¬ Effects â†’ ' + finalName)
                        } catch (engineErr: any) {
                            log(win, '    âš ï¸ Engine failed: ' + engineErr.message + ', skipping')
                        }
                    } else {
                        const ep = getEnginePath()
                        if (!ep) throw new Error('Engine not found')
                        await runEngine(ep, buildEngineConfig(mergedPath, finalPath, randomConfig), win)
                    }

                    if (needsSpeedPostProcess(randomConfig)) {
                        const tmpSpeed = finalPath.replace(/\.mp4$/i, '_pre_speed.mp4')
                        fs.renameSync(finalPath, tmpSpeed)
                        await runFF(['-y', '-i', tmpSpeed, '-c:v', 'copy',
                            '-af', 'atempo=' + (randomConfig.speed || 1).toFixed(3),
                            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', finalPath])
                        try { fs.unlinkSync(tmpSpeed) } catch {}
                    }
                    if (needsSeparateAudio(randomConfig)) {
                        const tmpAudio = finalPath.replace(/\.mp4$/i, '_pre_audio.mp4')
                        fs.renameSync(finalPath, tmpAudio)
                        const { af } = buildFilterChain(randomConfig)
                        const audioArgs: string[] = ['-y', '-i', tmpAudio]
                        if (af) audioArgs.push('-af', af)
                        audioArgs.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', finalPath)
                        await runFF(audioArgs)
                        try { fs.unlinkSync(tmpAudio) } catch {}
                    }

                    // â”€â”€ Post-export anti-detect: metadata + file hash â”€â”€
                    log(win, `    ðŸ“‹ Injecting ${randomConfig.deviceProfile} metadata...`)
                    await injectFakeMetadata(finalPath, randomConfig.deviceProfile)
                    appendUniqueHash(finalPath)

                    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
                    totalFinals++
                    log(win, '    âœ… Done â†’ ' + finalName)
                }

                if (deleteOriginals) {
                    for (const clip of clips) {
                        try { fs.unlinkSync(clip) } catch {}
                    }
                    log(win, '  ðŸ—‘ï¸ Deleted ' + clips.length + ' originals')
                }
            }

            log(win, '\nâœ… Shuffle Pipeline complete: ' + totalFinals + ' finals')
            return { success: true, finals: totalFinals }
        } catch (err: any) {
            log(win, 'âŒ Shuffle error: ' + err.message)
            return { success: false, error: err.message }
        }
    })


    ipcMain.handle('split:scanFolder', async (_e, { folderPath }) => ({
        videos: listVideos(folderPath)
    }))

    ipcMain.handle('split:getDuration', async (_e, { filePath }) => {
        try {
            const dur = await getVideoDuration(filePath)
            return { duration: dur }
        } catch (e: any) {
            return { duration: 0, error: e.message }
        }
    })

    ipcMain.handle('split:run', async (event, { inputPath, splitDuration, showTitle, showPart }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'No window' }
        if (!inputPath || !fs.existsSync(inputPath)) {
            return { success: false, error: 'File not found' }
        }

        try {
            stopped = false
            const useGpu = await checkNvenc()
            // If inputPath is a folder, scan videos and split each
            if (fs.statSync(inputPath).isDirectory()) {
                const vids = listVideos(inputPath).sort()
                if (vids.length === 0) return { success: false, error: "No video files found" }
                let totalParts = 0
                for (const vid of vids) {
                    if (stopped) break
                    const vidDur = await getVideoDuration(vid)
                    const vidParts = Math.ceil(vidDur / splitDuration)
                    const vidBase = path.basename(vid, path.extname(vid))
                    const vidOutDir = path.join(inputPath, vidBase + "_Parts")
                    fs.mkdirSync(vidOutDir, { recursive: true })
                    log(win, "Split: " + vidBase + " -> " + vidParts + " parts")
                    for (let i = 0; i < vidParts; i++) {
                        if (stopped) break
                        const start = i * splitDuration
                        const partLen = Math.min(splitDuration, vidDur - start)
                        if (partLen < 0.1) break
                        const partName = vidBase + "_Part" + String(i + 1).padStart(2, "0") + ".mp4"
                        const partPath = path.join(vidOutDir, partName)
                        await runFF(["-y", "-ss", String(start), "-i", vid, "-t", String(partLen),
                            "-c", "copy", "-avoid_negative_ts", "1", "-movflags", "+faststart", partPath])
                        log(win, "  [" + (i+1) + "/" + vidParts + "] " + partName)
                        totalParts++
                    }
                }
                return { success: true, parts: totalParts }
            }

            // Single file
            const duration = await getVideoDuration(inputPath)
            const numParts = Math.ceil(duration / splitDuration)
            const basename = path.basename(inputPath, path.extname(inputPath))

            // â”€â”€ Auto-create output folder â”€â”€
            const outDir = path.join(path.dirname(inputPath), `${basename}_Parts`)
            fs.mkdirSync(outDir, { recursive: true })

            log(win, `âœ‚ï¸ Splitting "${basename}" â†’ ${numParts} parts (${splitDuration}s) â†’ 9:16`)
            log(win, `ðŸ“ Output: ${outDir}`)
            log(win, `ðŸš€ GPU: ${useGpu ? 'NVENC (max speed)' : 'CPU'}`)

            // â”€â”€ Process parts in parallel (2 at a time for I/O balance) â”€â”€
            const PARALLEL = useGpu ? 2 : 1  // GPU can handle 2 concurrent encodes
            const queue: Array<{ idx: number; start: number; partLen: number; outPath: string }> = []

            for (let i = 0; i < numParts; i++) {
                const start = i * splitDuration
                const partLen = Math.min(splitDuration, duration - start)
                if (partLen < 0.1) break
                const partName = `${basename}_Part${String(i + 1).padStart(2, '0')}.mp4`
                queue.push({ idx: i, start, partLen, outPath: path.join(outDir, partName) })
            }

            // Process in batches
            for (let b = 0; b < queue.length; b += PARALLEL) {
                if (stopped) throw new Error('Stopped')
                const batch = queue.slice(b, b + PARALLEL)

                await Promise.all(batch.map(({ idx, start, partLen, outPath }) => {
                    // Build filter chain: 9:16 frame + optional title + part
                    const vFilters: string[] = []

                    // 9:16 portrait â€” scale fit + letterbox (use fast bilinear for speed)
                    vFilters.push(
                        'scale=1080:1920:force_original_aspect_ratio=decrease:flags=fast_bilinear',
                        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black'
                    )

                    // Title text â€” auto-wrap long titles
                    if (showTitle) {
                        // Split title into lines of max ~30 chars at word boundaries
                        const maxCharsPerLine = 30
                        const words = basename.split(/[\s_]+/)
                        const lines: string[] = []
                        let currentLine = ''
                        for (const word of words) {
                            if (currentLine.length + word.length + 1 > maxCharsPerLine && currentLine) {
                                lines.push(currentLine)
                                currentLine = word
                            } else {
                                currentLine = currentLine ? currentLine + ' ' + word : word
                            }
                        }
                        if (currentLine) lines.push(currentLine)

                        // Render each line as a separate drawtext
                        const lineHeight = 42 // fontsize + gap
                        const startY = 50
                        for (let li = 0; li < lines.length; li++) {
                            const lineEscaped = lines[li]
                                .replace(/\\/g, '\\\\\\\\')
                                .replace(/'/g, "\\\\'")
                                .replace(/:/g, '\\\\:')
                                .replace(/%/g, '%%')
                            vFilters.push(
                                `drawtext=text='${lineEscaped}':fontsize=34:fontcolor=white:borderw=3:bordercolor=black@0.7:x=(w-tw)/2:y=${startY + li * lineHeight}`
                            )
                        }
                    }

                    // Part number
                    if (showPart) {
                        vFilters.push(
                            `drawtext=text='Part ${idx + 1}':fontsize=30:fontcolor=white:borderw=3:bordercolor=black@0.7:x=(w-tw)/2:y=h-80`
                        )
                    }

                    const args = ['-y']

                    // GPU accelerated decode (much faster input processing)
                    if (useGpu) args.push('-hwaccel', 'cuda')

                    // Fast seek BEFORE input (keyframe seek)
                    args.push('-ss', String(start), '-i', inputPath, '-t', String(partLen))

                    args.push('-vf', vFilters.join(','))

                    // Encoding: fastest possible
                    if (useGpu) args.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23')
                    else args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23')

                    args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath)

                    return runFF(args).then(() => {
                        log(win, `  [${idx + 1}/${numParts}] âœ… ${path.basename(outPath)}`)
                    })
                }))
            }

            log(win, `âœ… Split complete: ${numParts} parts â†’ ${outDir}`)
            return { success: true, parts: numParts }
        } catch (e: any) {
            log(win, `âŒ Split failed: ${e.message}`)
            return { success: false, error: e.message }
        }
    })
}
