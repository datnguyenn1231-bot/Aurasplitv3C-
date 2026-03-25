/**
 * SK2 Merge IPC — Main merge pipeline + IPC registration.
 * Delegates to merge-helpers, merge-audio, merge-transitions modules.
 */

import { ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

import {
    VIDEO_EXTS, AUDIO_EXTS, activeProc,
    setStopped, setActiveProc,
    checkNvenc, log, listMedia, parseOutputDims,
    run, getEncoderArgs,
} from './merge-helpers.js'

import { autoFixVideos, concatCopy, renderWithTransitions } from './merge-transitions.js'
import { extractAudioFromVideos, concatAudioFiles, mixAudioTracks, mixMusic } from './merge-audio.js'
import { isClean } from '../security/integrity.js'

// ── Ghost verify (Layer 4) — silent degradation ──
let _g = true
function _ghostSync() {
    try {
        const fs = require('node:fs')
        const p = require('node:path')
        // Check license cache exists + integrity flag
        _g = isClean()
        const cachePath = p.join(require('electron').app.getPath('userData'), '.lc')
        if (!fs.existsSync(cachePath)) _g = false
    } catch { _g = false }
}
setTimeout(_ghostSync, 8000 + Math.random() * 5000)

// ── Main merge pipeline (v1 audio architecture) ──
async function runMerge(config: {
    outputFolder: string
    transitionIn: string
    transitionOut: string
    transitionDuration: number
    finalOutput: string
    musicPath: string
    deleteOriginals: boolean
    applyHDR: boolean
}, win: BrowserWindow): Promise<string> {
    setStopped(false)
    const { outputFolder, transitionIn, transitionDuration, finalOutput, musicPath, deleteOriginals, applyHDR } = config
    const vidDir = path.join(outputFolder, 'videos')

    const videos = listMedia(vidDir, VIDEO_EXTS)
    if (videos.length === 0) {
        log(win, '❌ No videos found in videos/ folder')
        return ''
    }

    // Scan for folder audio (audio/audios/music/bgm subfolder)
    const audioFolderNames = ['audio', 'audios', 'music', 'bgm']
    let folderAudios: string[] = []
    for (const name of audioFolderNames) {
        const audDir = path.join(outputFolder, name)
        const found = listMedia(audDir, AUDIO_EXTS)
        if (found.length > 0) { folderAudios = found; break }
    }

    log(win, `📂 Found ${videos.length} videos`)
    if (folderAudios.length > 0) log(win, `🎵 Found ${folderAudios.length} audio files in folder`)
    const { w, h } = parseOutputDims(finalOutput)
    const needTransition = videos.length >= 2 && transitionIn !== 'None'
    const hasExtraAudio = folderAudios.length > 0 || (musicPath && fs.existsSync(musicPath))

    try {
        // Detect encoder
        const gpuAvailable = await checkNvenc()
        log(win, gpuAvailable
            ? `🚀 Encoder: GPU (NVENC)`
            : '💻 Encoder: CPU (libx264)')

        // Step 1: Extract audio from source videos
        let extractedAudio: string[] = []
        if (hasExtraAudio || needTransition) {
            log(win, '[1/5] Extracting audio from source videos...')
            extractedAudio = await extractAudioFromVideos(outputFolder, videos, win)
            if (extractedAudio.length > 0) {
                log(win, `[AUDIO] Extracted audio from ${extractedAudio.length}/${videos.length} videos`)
            } else {
                log(win, '[AUDIO] No audio found in source videos (silent clips)')
            }
        }

        // Step 2: Auto-fix videos if needed
        log(win, `[2/5] Checking video formats (target: ${w}×${h})...`)
        const fixedVideos = await autoFixVideos(outputFolder, videos, w, h, win)

        // Step 3: Render video track (video-only, no audio)
        const videoTrack = path.join(outputFolder, 'temp_video_track.mp4')
        if (needTransition) {
            log(win, `[3/5] Rendering with "${transitionIn}" transitions (${transitionDuration}s)...`)
            await renderWithTransitions(outputFolder, fixedVideos, transitionIn, transitionDuration, win, videoTrack, w, h)
        } else {
            log(win, '[3/5] Concatenating videos (no transition)...')
            await concatCopy(outputFolder, fixedVideos, videoTrack, win)
        }

        // Step 4: Build audio track
        log(win, '[4/5] Building audio track...')
        let audioTrack = ''
        try {
            let videoAudio = ''
            if (extractedAudio.length > 0) {
                videoAudio = await concatAudioFiles(outputFolder, extractedAudio, 'temp_video_audio.m4a', win)
                log(win, `[AUDIO] Concatenated video audio track`)
            }

            let folderAudio = ''
            if (folderAudios.length > 0) {
                folderAudio = await concatAudioFiles(outputFolder, folderAudios, 'temp_folder_audio.m4a', win)
                log(win, `[AUDIO] Concatenated folder audio track`)
            }

            let voice = ''
            if (videoAudio && folderAudio) {
                voice = await mixAudioTracks(outputFolder, videoAudio, folderAudio, win)
            } else if (folderAudio) {
                voice = folderAudio
            } else if (videoAudio) {
                voice = videoAudio
            }

            if (voice && musicPath && fs.existsSync(musicPath)) {
                audioTrack = await mixMusic(outputFolder, voice, musicPath, win)
                log(win, '[AUDIO] Mixed in background music (25% volume, looped)')
            } else if (voice) {
                audioTrack = voice
            }
        } catch (e: any) {
            log(win, `⚠️ Audio build failed: ${e.message} — continuing without audio`)
            audioTrack = ''
        }

        // Step 5: MUX video + audio → final output
        let num = 1
        let finalOut: string
        do {
            finalOut = path.join(outputFolder, `FINAL_${num}.mp4`)
            num++
        } while (fs.existsSync(finalOut))

        if (audioTrack && fs.existsSync(audioTrack)) {
            log(win, '[5/5] MUX: video + audio → final...')
            // Ghost Layer 4: silent audio degradation if tampered
            const muxArgs = [
                '-y', '-i', videoTrack, '-i', audioTrack,
                '-map', '0:v:0', '-map', '1:a:0',
            ]
            if (_g) {
                // Normal: stream-copy audio (preserve original volume)
                muxArgs.push('-c:v', 'copy', '-c:a', 'copy')
            } else {
                // Ghost: re-encode with volume reduction
                muxArgs.push('-af', 'volume=0.1', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k')
            }
            muxArgs.push('-shortest', '-movflags', '+faststart', '-loglevel', 'error', finalOut)
            await run(muxArgs, win)
        } else {
            log(win, '[5/5] MUX: video only (no audio track)...')
            await run([
                '-y', '-i', videoTrack,
                '-c', 'copy', '-movflags', '+faststart',
                '-loglevel', 'error', finalOut,
            ], win)
        }

        log(win, `✅ MERGE COMPLETED: ${path.basename(finalOut)}`)

        // Step 6 (optional): Apply HDR Enhancement
        if (applyHDR) {
            log(win, '[HDR] Applying HDR Enhancement...')
            const hdrOut = finalOut.replace('.mp4', '_HDR.mp4')
            const hdrFilter = [
                'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
                'eq=contrast=1.10:saturation=1.10:brightness=0.010',
                'unsharp=5:5:0.9:3:3:0.5',
                'format=yuv420p',
            ].join(',')
            const useGpu = await checkNvenc()
            await run([
                '-y', '-i', finalOut,
                '-vf', hdrFilter,
                '-map', '0:v:0', '-map', '0:a?',
                '-c:a', 'copy',
                ...getEncoderArgs(useGpu),
                '-movflags', '+faststart',
                '-loglevel', 'error', hdrOut,
            ], win)
            try { fs.unlinkSync(finalOut) } catch { /* */ }
            fs.renameSync(hdrOut, finalOut)
            log(win, `✅ HDR Applied: ${path.basename(finalOut)}`)
        }

        // Cleanup temp files
        const tempFiles = ['temp_video_track.mp4', 'temp_video_audio.m4a', 'temp_folder_audio.m4a',
            'temp_mixed_audio.m4a', 'temp_final_audio.m4a']
        for (const tmp of tempFiles) {
            const p = path.join(outputFolder, tmp)
            if (fs.existsSync(p)) fs.unlinkSync(p)
        }
        const fixDir = path.join(outputFolder, '_merge_fix')
        if (fs.existsSync(fixDir)) fs.rmSync(fixDir, { recursive: true, force: true })
        const tmpDir = path.join(outputFolder, '_merge_tmp')
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })

        // Delete originals
        if (deleteOriginals) {
            log(win, '🗑 Deleting original files...')
            // Delete entire videos/ folder
            if (fs.existsSync(vidDir)) {
                fs.rmSync(vidDir, { recursive: true, force: true })
                log(win, '🗑 Deleted videos/ folder')
            }
            // Delete entire audios/ folder
            const audiosDir = path.join(outputFolder, 'audios')
            if (fs.existsSync(audiosDir)) {
                fs.rmSync(audiosDir, { recursive: true, force: true })
                log(win, '🗑 Deleted audios/ folder')
            }
        }

        return finalOut
    } catch (e: any) {
        if (e.message === 'STOPPED') {
            log(win, '⏹ Merge stopped by user')
        } else {
            log(win, `❌ Merge error: ${e.message}`)
        }
        // Cleanup temp dirs even on error/stop
        try {
            const fixDir = path.join(outputFolder, '_merge_fix')
            if (fs.existsSync(fixDir)) fs.rmSync(fixDir, { recursive: true, force: true })
            const tmpDir = path.join(outputFolder, '_merge_tmp')
            if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
            const tempFiles = ['temp_video_track.mp4', 'temp_video_audio.m4a', 'temp_folder_audio.m4a',
                'temp_mixed_audio.m4a', 'temp_final_audio.m4a']
            for (const tmp of tempFiles) {
                const p = path.join(outputFolder, tmp)
                if (fs.existsSync(p)) fs.unlinkSync(p)
            }
        } catch {}
        return ''
    }
}

// ── Scan folder for merge ──────────────────
function scanMergeFolder(folderPath: string): {
    videos: string[]
    audios: string[]
    hasVideosDir: boolean
    autoAudio: string
} {
    const vidDir = path.join(folderPath, 'videos')

    const audioFolderNames = ['audio', 'audios', 'music', 'bgm']
    let audioFiles: string[] = []
    for (const name of audioFolderNames) {
        const audDir = path.join(folderPath, name)
        const found = listMedia(audDir, AUDIO_EXTS)
        if (found.length > 0) {
            audioFiles = found
            break
        }
    }

    if (audioFiles.length === 0) {
        audioFiles = listMedia(folderPath, AUDIO_EXTS)
    }

    return {
        videos: listMedia(vidDir, VIDEO_EXTS),
        audios: audioFiles,
        hasVideosDir: fs.existsSync(vidDir),
        autoAudio: audioFiles.length > 0 ? audioFiles[0] : '',
    }
}

// ── IPC Registration ───────────────────────
export function registerMergeIPC(): void {
    ipcMain.handle('merge:scan', async (_event, { folderPath }) => {
        return scanMergeFolder(folderPath)
    })

    ipcMain.handle('merge:run', async (event, { config }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'No window' }
        const finalPath = await runMerge(config, win)
        return { success: !!finalPath, finalPath }
    })

    ipcMain.handle('merge:stop', async () => {
        setStopped(true)
        if (activeProc) {
            activeProc.kill('SIGTERM')
            setActiveProc(null)
        }
        return { stopped: true }
    })
}
