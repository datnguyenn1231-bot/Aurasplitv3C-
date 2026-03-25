/**
 * merge-audio — Audio extraction, concatenation, and mixing for SK2 Merge.
 * Extracted from merge.ipc.ts to enforce ≤300 lines/file.
 */

import { BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

import { run, log, probe, escapeConcat, isStopped } from './merge-helpers.js'

// ── Extract audio from each video (skip silent ones) ──
export async function extractAudioFromVideos(
    outputFolder: string, videos: string[], win: BrowserWindow
): Promise<string[]> {
    const tmpDir = path.join(outputFolder, '_merge_tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const extracted: string[] = []

    for (let i = 0; i < videos.length; i++) {
        if (isStopped()) throw new Error('STOPPED')
        const v = videos[i]
        const outAudio = path.join(tmpDir, `audio_${String(i).padStart(4, '0')}.m4a`)

        // Probe: check if video has audio stream
        try {
            const info = await probe(v)
            const hasAudio = info.streams?.some((s: any) => s.codec_type === 'audio')
            if (!hasAudio) {
                log(win, `[AUDIO] Skip (silent): ${path.basename(v)}`)
                continue
            }
        } catch {
            // If probe fails, try extraction anyway
        }

        try {
            await run([
                '-y', '-i', v,
                '-vn', '-c:a', 'aac', '-b:a', '192k',
                '-loglevel', 'error', outAudio,
            ], win)

            if (fs.existsSync(outAudio) && fs.statSync(outAudio).size > 0) {
                extracted.push(outAudio)
            }
        } catch {
            log(win, `[AUDIO] Skip (error): ${path.basename(v)}`)
        }
    }
    return extracted
}

// ── Concat audio files into one track ──────
export async function concatAudioFiles(
    outputFolder: string, audioFiles: string[], outputName: string, win: BrowserWindow
): Promise<string> {
    if (audioFiles.length === 0) return ''

    const tmpDir = path.join(outputFolder, '_merge_tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const listFile = path.join(tmpDir, outputName.replace('.m4a', '_list.txt'))
    const lines = audioFiles.map(f => `file '${escapeConcat(f)}'`)
    fs.writeFileSync(listFile, lines.join('\n'), 'utf-8')

    const outPath = path.join(outputFolder, outputName)
    await run([
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:a', 'aac', '-b:a', '192k', '-loglevel', 'error', outPath,
    ], win)
    return outPath
}

// ── Mix two audio tracks (video audio 30% + folder audio 100%) ──
export async function mixAudioTracks(
    outputFolder: string, videoAudioPath: string, folderAudioPath: string, win: BrowserWindow
): Promise<string> {
    if (!videoAudioPath || !fs.existsSync(videoAudioPath)) return folderAudioPath
    if (!folderAudioPath || !fs.existsSync(folderAudioPath)) return videoAudioPath

    const outPath = path.join(outputFolder, 'temp_mixed_audio.m4a')
    await run([
        '-y',
        '-i', videoAudioPath, '-i', folderAudioPath,
        '-filter_complex',
        '[0:a]aformat=channel_layouts=stereo,volume=0.3[bg];' +
        '[1:a]aformat=channel_layouts=stereo,volume=1.0[fg];' +
        '[bg][fg]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a]',
        '-map', '[a]', '-c:a', 'aac', '-b:a', '192k',
        '-loglevel', 'error', outPath,
    ], win)
    log(win, '[AUDIO] Mixed video audio (30%) + folder audio (100%)')
    return outPath
}

// ── Mix voice + background music (music loops, 25% volume) ──
export async function mixMusic(
    outputFolder: string, voicePath: string, musicFilePath: string, win: BrowserWindow
): Promise<string> {
    if (!voicePath || !fs.existsSync(voicePath)) return ''
    if (!musicFilePath || !fs.existsSync(musicFilePath)) return voicePath

    const outPath = path.join(outputFolder, 'temp_final_audio.m4a')
    await run([
        '-y',
        '-i', voicePath, '-stream_loop', '-1', '-i', musicFilePath,
        '-filter_complex',
        '[0:a]aformat=channel_layouts=stereo[a1];' +
        '[1:a]aformat=channel_layouts=stereo,volume=0.25[a2];' +
        '[a1][a2]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]',
        '-map', '[a]', '-c:a', 'aac', '-b:a', '192k',
        '-loglevel', 'error', outPath,
    ], win)
    return outPath
}
