/**
 * merge-transitions — Transition rendering for SK2 Merge engine.
 * Contains custom transitions, segment-level smart rendering, and xfade.
 * Extracted from merge.ipc.ts to enforce ≤300 lines/file.
 */

import { spawn } from 'child_process'
import { BrowserWindow, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

import { getFFmpegPath } from './ffmpeg.ipc.js'
import {
    resolveTransition as resolveXfade,
    isCustomTransition, FADE_TO_BLACK_CONFIG,
} from '../utils/transitions.js'

import {
    run, log, probe, escapeConcat, getDuration,
    checkNvenc, getEncoderArgs, isStopped,
} from './merge-helpers.js'

// ── Auto-fix videos to same codec/res/fps ──
// Skip entirely if CUDA engine is available (engine handles decode+scale internally)
export async function autoFixVideos(
    outputFolder: string, videos: string[], targetW: number, targetH: number,
    win: BrowserWindow
): Promise<string[]> {
    // Check if CUDA engine is available — if so, skip Fix entirely
    if (getEnginePath()) {
        log(win, `⚡ CUDA Engine found → Skip Fix (engine handles decode+scale)`)
        return videos
    }

    // FFmpeg fallback: fix videos in parallel
    const fixDir = path.join(outputFolder, '_merge_fix')
    fs.mkdirSync(fixDir, { recursive: true })

    const useGpu = await checkNvenc()
    const parallel = useGpu ? 10 : 4
    const encoderLabel = useGpu ? '🚀 GPU (NVENC)' : '💻 CPU (libx264)'
    log(win, `⚙️ Encoder: ${encoderLabel} (${parallel}x parallel)`)

    // Probe all videos first to check which need fixing
    const probeResults = await Promise.all(videos.map(v => probe(v)))
    const needsFixArr = probeResults.map((info) => {
        const vs = info.streams?.find((s: any) => s.codec_type === 'video')
        return !vs || vs.width !== targetW || vs.height !== targetH || vs.codec_name !== 'h264'
    })

    const skipCount = needsFixArr.filter(f => !f).length
    if (skipCount > 0) log(win, `⏭ ${skipCount}/${videos.length} already correct format`)

    // Build fix jobs
    const fixed: string[] = new Array(videos.length)
    const jobs: (() => Promise<void>)[] = []
    let completedCount = 0

    for (let i = 0; i < videos.length; i++) {
        if (!needsFixArr[i]) {
            fixed[i] = videos[i]
            continue
        }
        const idx = i
        jobs.push(async () => {
            if (isStopped()) return
            const outPath = path.join(fixDir, `fix_${idx}${path.extname(videos[idx])}`)
            await run([
                '-y', '-i', videos[idx],
                '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2`,
                ...getEncoderArgs(useGpu),
                '-r', '30', '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', '-loglevel', 'error', outPath,
            ], win)
            fixed[idx] = outPath
            completedCount++
            log(win, `[FIX ${completedCount}/${jobs.length}] ${path.basename(videos[idx])}`)
        })
    }

    // Run fix jobs in parallel batches
    for (let g = 0; g < jobs.length; g += parallel) {
        if (isStopped()) throw new Error('STOPPED')
        const batch = jobs.slice(g, Math.min(g + parallel, jobs.length))
        await Promise.all(batch.map(fn => fn()))
    }

    return fixed
}

// ── Simple concat (no transitions) ─────────
export async function concatCopy(
    outputFolder: string, videos: string[], outPath: string, win: BrowserWindow
): Promise<void> {
    const tmpDir = path.join(outputFolder, '_merge_tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const listFile = path.join(tmpDir, 'concat.txt')
    const lines = videos.map(v => `file '${escapeConcat(v)}'`)
    fs.writeFileSync(listFile, lines.join('\n'), 'utf-8')

    await run([
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:v', 'copy', '-c:a', 'copy',
        '-movflags', '+faststart', '-loglevel', 'error', outPath,
    ], win)
}

// ── Custom transition rendering (Fade to Black, etc.) ──
async function renderWithCustomTransition(
    outputFolder: string, videos: string[], transName: string,
    win: BrowserWindow, outPath: string
): Promise<void> {
    const cfg = FADE_TO_BLACK_CONFIG
    const totalTransDur = cfg.fadeOutDuration + cfg.blackHoldDuration + cfg.fadeInDuration
    log(win, `[CUSTOM] "${transName}" (${totalTransDur}s per cut)`)

    const durations: number[] = []
    for (const v of videos) durations.push(await getDuration(v))

    const tmpDir = path.join(outputFolder, '_merge_tmp')
    fs.mkdirSync(tmpDir, { recursive: true })

    const useGpu = await checkNvenc()
    const segments: string[] = []

    for (let i = 0; i < videos.length; i++) {
        if (isStopped()) throw new Error('STOPPED')
        const v = videos[i]
        const dur = durations[i]

        const fadeIn = i > 0
        const fadeOut = i < videos.length - 1

        const segOut = path.join(tmpDir, `seg_${String(i).padStart(4, '0')}.mp4`)

        let vf = ''
        if (fadeIn && fadeOut) {
            vf = `fade=t=in:st=0:d=${cfg.fadeInDuration}:color=black,` +
                `fade=t=out:st=${Math.max(0, dur - cfg.fadeOutDuration)}:d=${cfg.fadeOutDuration}:color=black`
        } else if (fadeIn) {
            vf = `fade=t=in:st=0:d=${cfg.fadeInDuration}:color=black`
        } else if (fadeOut) {
            vf = `fade=t=out:st=${Math.max(0, dur - cfg.fadeOutDuration)}:d=${cfg.fadeOutDuration}:color=black`
        }

        const args = ['-y', '-i', v]
        if (vf) args.push('-vf', vf)
        args.push('-an', ...getEncoderArgs(useGpu))
        args.push('-movflags', '+faststart', '-loglevel', 'error', segOut)
        await run(args, win)
        segments.push(segOut)

        // Add black hold between clips (except after last)
        if (fadeOut && cfg.blackHoldDuration > 0) {
            const info = await probe(v)
            const vs = info.streams?.find((s: any) => s.codec_type === 'video')
            const w = vs?.width || 1920
            const h = vs?.height || 1080
            const blackSeg = path.join(tmpDir, `black_${String(i).padStart(4, '0')}.mp4`)
            await run([
                '-y', '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:d=${cfg.blackHoldDuration}:r=30`,
                ...getEncoderArgs(useGpu),
                '-movflags', '+faststart', '-loglevel', 'error', blackSeg,
            ], win)
            segments.push(blackSeg)
        }

        log(win, `[CUSTOM] Processed ${i + 1}/${videos.length}: ${path.basename(v)}`)
    }

    const listFile = path.join(tmpDir, 'custom_concat.txt')
    const lines = segments.map(f => `file '${escapeConcat(f)}'`)
    fs.writeFileSync(listFile, lines.join('\n'), 'utf-8')

    await run([
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:v', 'copy', '-an',
        '-movflags', '+faststart', '-loglevel', 'error', outPath,
    ], win)
    log(win, `[CUSTOM] ✅ Rendered with "${transName}"`)
}

// ── Smart Render v3 — Only encode transition zones ──────────
// Body segments: -c copy (instant, 0 encode)
// Transition zones: 1 FFmpeg call each (inline seek + xfade, ~1-2s encode)
// Concat: -c copy (instant)
// For 6min output: encode ~110s transitions instead of 360s full video

async function renderSmartV3(
    outputFolder: string, videos: string[], transIn: string,
    transDur: number, win: BrowserWindow, outPath: string
): Promise<void> {
    const useGpu = await checkNvenc()
    const tmpDir = path.join(outputFolder, '_smart_render')
    fs.mkdirSync(tmpDir, { recursive: true })

    const n = videos.length
    const parallel = useGpu ? 10 : 4

    // Step 0: Get all durations
    log(win, `[RENDER] Getting durations for ${n} clips...`)
    const durations: number[] = []
    for (const v of videos) durations.push(await getDuration(v))

    // Step 1: Resolve transitions
    const transitions: string[] = []
    for (let i = 0; i < n - 1; i++) {
        transitions.push(resolveXfade(transIn))
    }

    // Step 2: Trim body segments (-c copy = instant, no GPU)
    log(win, `[RENDER] Trimming ${n} body segments (-c copy)...`)
    const bodyFiles: string[] = []
    const trimJobs: (() => Promise<void>)[] = []

    for (let i = 0; i < n; i++) {
        if (isStopped()) throw new Error('STOPPED')
        const bodyOut = path.join(tmpDir, `b${String(i).padStart(4, '0')}.mp4`)
        bodyFiles.push(bodyOut)

        const ss = i === 0 ? 0 : transDur
        const bodyLen = i === n - 1
            ? durations[i] - (i === 0 ? 0 : transDur)
            : durations[i] - (i === 0 ? transDur : 2 * transDur)

        if (bodyLen > 0.01) {
            const ci = i, css = ss, cbl = bodyLen
            trimJobs.push(async () => {
                const ffPath = getFFmpegPath()
                await new Promise<void>((resolve, reject) => {
                    const proc = spawn(ffPath, [
                        '-y', '-ss', css.toFixed(3), '-t', cbl.toFixed(3),
                        '-i', videos[ci],
                        '-c', 'copy', '-an', '-loglevel', 'error', bodyOut,
                    ], { windowsHide: true })
                    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`body-trim exit ${code}`)))
                    proc.on('error', reject)
                })
            })
        } else {
            trimJobs.push(async () => { bodyFiles[i] = '' })
        }
    }

    // Run 20 parallel (copy is instant, no GPU)
    for (let g = 0; g < trimJobs.length; g += 20) {
        if (isStopped()) throw new Error('STOPPED')
        await Promise.all(trimJobs.slice(g, g + 20).map(fn => fn()))
    }
    log(win, `[RENDER] ✅ Body segments done (copy)`)

    // Step 3: Render transition zones (1 FFmpeg per transition, inline seek + xfade)
    log(win, `[RENDER] Rendering ${n - 1} transitions (${parallel} parallel, ${useGpu ? 'NVENC' : 'CPU'})...`)
    const transFiles: string[] = []
    const transJobs: (() => Promise<void>)[] = []

    for (let i = 0; i < n - 1; i++) {
        const transOut = path.join(tmpDir, `t${String(i).padStart(4, '0')}.mp4`)
        transFiles.push(transOut)

        const ci = i
        transJobs.push(async () => {
            if (isStopped()) throw new Error('STOPPED')
            const tailStart = Math.max(0, durations[ci] - transDur)
            const tailLen = durations[ci] - tailStart
            const headLen = Math.min(transDur, durations[ci + 1])
            const offset = Math.max(0, tailLen - transDur)

            const ffPath = getFFmpegPath()
            await new Promise<void>((resolve, reject) => {
                const proc = spawn(ffPath, [
                    '-y',
                    '-ss', tailStart.toFixed(3), '-t', tailLen.toFixed(3), '-i', videos[ci],
                    '-ss', '0', '-t', headLen.toFixed(3), '-i', videos[ci + 1],
                    '-filter_complex',
                    `[0:v][1:v]xfade=transition=${transitions[ci]}:duration=${transDur}:offset=${offset.toFixed(3)}[vout]`,
                    '-map', '[vout]', '-an',
                    ...getEncoderArgs(useGpu),
                    '-movflags', '+faststart', '-loglevel', 'error', transOut,
                ], { windowsHide: true })
                let err = ''
                proc.stderr?.on('data', (d: Buffer) => { err += d.toString() })
                proc.on('close', (code) => {
                    if (code === 0) resolve()
                    else reject(new Error(`xfade[${ci}] exit ${code}: ${err.slice(0, 200)}`))
                })
                proc.on('error', reject)
            })
        })
    }

    // Run in parallel batches
    for (let g = 0; g < transJobs.length; g += parallel) {
        if (isStopped()) throw new Error('STOPPED')
        const end = Math.min(g + parallel, transJobs.length)
        log(win, `[RENDER] ⏱ Transitions ${g + 1}-${end}/${transJobs.length}...`)
        await Promise.all(transJobs.slice(g, end).map(fn => fn()))
    }
    log(win, `[RENDER] ✅ All transitions done`)

    // Step 4: Concat body + transition segments (-c copy)
    log(win, `[RENDER] Concatenating ${2 * n - 1} segments (-c copy)...`)
    const segments: string[] = []
    for (let i = 0; i < n; i++) {
        if (bodyFiles[i] && fs.existsSync(bodyFiles[i])) segments.push(bodyFiles[i])
        if (i < n - 1 && fs.existsSync(transFiles[i])) segments.push(transFiles[i])
    }

    const concatFile = path.join(tmpDir, 'concat.txt')
    fs.writeFileSync(concatFile, segments.map(f => `file '${escapeConcat(f)}'`).join('\n'), 'utf-8')

    await run([
        '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
        '-c', 'copy', '-movflags', '+faststart',
        '-loglevel', 'error', outPath,
    ], win)

    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* */ }
    log(win, `[RENDER] ✅ Smart Render complete!`)
}

// ── CUDA Engine merge ──────────────────────────────
// Pipeline: aura_engine --mode merge --config merge.json
// NVDEC decode → CudaFrame → CUDA transition kernel → NVENC encode
// Single process, zero temp files, 50+ transition types

function getEnginePath(): string | null {
    if (app.isPackaged) {
        const prodCandidates = [
            path.join(process.resourcesPath, 'binaries', 'aura_engine.exe'),
            path.join(process.resourcesPath, 'engine', 'aura_engine.exe'),
        ]
        for (const p of prodCandidates) {
            if (fs.existsSync(p)) return p
        }
    }

    const appRoot = process.env.APP_ROOT || '.'
    const projectRoot = process.cwd()
    const candidates = [
        path.join(appRoot, 'engine', 'build', 'Release', 'aura_engine.exe'),
        path.join(appRoot, 'engine', 'aura_engine.exe'),
        path.join(appRoot, 'binaries', 'aura_engine.exe'),
        path.join(projectRoot, 'engine', 'build', 'Release', 'aura_engine.exe'),
        path.join(projectRoot, 'engine', 'aura_engine.exe'),
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return null
}

async function renderWithEngine(
    videos: string[], transIn: string, transDur: number,
    win: BrowserWindow, outPath: string, targetW: number, targetH: number,
): Promise<void> {
    const enginePath = getEnginePath()
    if (!enginePath) throw new Error('Engine not found')

    // Resolve transitions for each pair
    const transitions: string[] = []
    for (let i = 0; i < videos.length - 1; i++) {
        transitions.push(resolveXfade(transIn))
    }

    // Write merge config JSON
    const tmpConfig = path.join(os.tmpdir(), `merge_config_${Date.now()}.json`)
    const config = {
        videos,
        transitions,
        transition_duration: transDur,
        output: outPath,
        width: targetW,
        height: targetH,
        gpu: await checkNvenc(),
        ffmpeg_path: getFFmpegPath(),
    }
    fs.writeFileSync(tmpConfig, JSON.stringify(config, null, 2), 'utf-8')

    log(win, `⚡ CUDA Engine merge: ${videos.length} clips, ${transitions.length} transitions`)
    for (let i = 0; i < videos.length; i++) {
        log(win, `  📹 [${i + 1}] ${path.basename(videos[i])}${i < transitions.length ? ` → (${transitions[i]})` : ''}`)
    }

    return new Promise((resolve, reject) => {
        if (isStopped()) {
            try { fs.unlinkSync(tmpConfig) } catch { /* */ }
            return reject(new Error('STOPPED'))
        }

        const proc = spawn(enginePath, ['--mode', 'merge', '--config', tmpConfig], {
            windowsHide: true,
        })

        proc.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(l => l.trim())
            for (const line of lines) {
                try {
                    const j = JSON.parse(line)
                    if (j.progress !== undefined) {
                        const pct = Math.round(j.progress * 100)
                        log(win, `  ⚡ Engine: ${pct}% (${Math.round(j.fps || 0)} fps)`)
                    }
                    if (j.log) {
                        log(win, `  [ENGINE] ${j.log}`)
                    }
                    if (j.done) {
                        log(win, j.success ? '  ✅ Engine merge done' : '  ❌ Engine merge failed')
                    }
                } catch { /* not JSON */ }
            }
        })

        let stderr = ''
        proc.stderr?.on('data', (d: Buffer) => {
            const s = d.toString()
            stderr += s
            const sLines = s.split('\n')
            for (const sLine of sLines) {
                const trimmed = sLine.trim()
                if (trimmed && (trimmed.includes('[MERGE]') || trimmed.includes('[CUDA]') || trimmed.includes('[ENGINE]')))
                    log(win, `  ${trimmed}`)
            }
        })

        proc.on('close', (code) => {
            try { fs.unlinkSync(tmpConfig) } catch { /* */ }
            if (code === 0) resolve()
            else reject(new Error(`Engine merge exit ${code}: ${stderr.slice(-300)}`))
        })
        proc.on('error', (e) => {
            try { fs.unlinkSync(tmpConfig) } catch { /* */ }
            reject(e)
        })
    })
}

// ── Dispatcher ──
export async function renderWithTransitions(
    _outputFolder: string, videos: string[], transIn: string,
    duration: number, win: BrowserWindow, outPath: string,
    targetW?: number, targetH?: number,
): Promise<void> {
    if (videos.length < 2) {
        fs.copyFileSync(videos[0], outPath)
        return
    }

    if (isCustomTransition(transIn)) {
        await renderWithCustomTransition(_outputFolder, videos, transIn, win, outPath)
        return
    }

    // Try CUDA engine first (fastest)
    const enginePath = getEnginePath()
    if (enginePath) {
        try {
            log(win, `🔥 C++ AuraEngine FOUND → CUDA merge`)
            await renderWithEngine(
                videos, transIn, duration, win, outPath,
                targetW || 1920, targetH || 1080,
            )
            return
        } catch (e: any) {
            log(win, `⚠️ Engine fallback → FFmpeg Smart Render: ${e.message}`)
        }
    }

    // Fallback: FFmpeg Smart Render v3
    await renderSmartV3(_outputFolder, videos, transIn, duration, win, outPath)
}

