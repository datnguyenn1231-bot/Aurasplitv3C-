/**
 * SK2 Merge Constants — Transition options, output presets, config type.
 *
 * NOTE: Runtime transition logic (resolveTransition, getRandomTransition)
 * lives in electron/utils/transitions.ts (main process only).
 * This file provides UI constants for the renderer process.
 */

// ══════════════════════════════════════════════
// Random by Group (separate dropdown)
// ══════════════════════════════════════════════

/**
 * RANDOM_GROUPS — Separate dropdown for random-by-group.
 * Click a group → applies random transitions from that group only.
 */
export const RANDOM_GROUPS = {
    '🎲 Tất cả': 'Random',
    '🎬 Documentary / Pro': 'Random: Documentary / Pro',
    '🌊 Smooth': 'Random: Smooth',
    '🧹 Wipe': 'Random: Wipe',
    '📦 Slide': 'Random: Slide',
    '🎭 Cover': 'Random: Cover',
    '👁️ Reveal': 'Random: Reveal',
    '⭕ Shape': 'Random: Shape',
    '🚪 Barn Door': 'Random: Barn Door',
    '🌬️ Slice / Wind': 'Random: Slice / Wind',
    '✨ Effects': 'Random: Effects',
} as const

// ══════════════════════════════════════════════
// Transition IN / OUT (manual selection)
// ══════════════════════════════════════════════

/**
 * TRANSITIONS_IN — Clip-to-clip transitions (no Random here).
 * For manual transition selection.
 */
export const TRANSITIONS_IN = {
    '── Cơ bản ──': ['None'],
    '🎬 Documentary / Pro': [
        'Dissolve', 'Fade', 'Fade Black', 'Fade White',
        'Fadegrays', 'FadeFast', 'FadeSlow', 'Fade to Black',
    ],
    '🌊 Smooth': [
        'Smooth Left', 'Smooth Right', 'Smooth Up', 'Smooth Down',
    ],
    '🧹 Wipe': [
        'Wipe Left', 'Wipe Right', 'Wipe Up', 'Wipe Down',
        'Wipe TL', 'Wipe TR', 'Wipe BL', 'Wipe BR',
    ],
    '📦 Slide': [
        'Slide Left', 'Slide Right', 'Slide Up', 'Slide Down',
    ],
    '🎭 Cover': [
        'Cover Left', 'Cover Right', 'Cover Up', 'Cover Down',
    ],
    '👁️ Reveal': [
        'Reveal Left', 'Reveal Right', 'Reveal Up', 'Reveal Down',
    ],
    '⭕ Shape': [
        'Circle Open', 'Circle Close', 'Circle Crop', 'Rect Crop', 'Radial',
    ],
    '🚪 Barn Door': [
        'Horz Open', 'Horz Close', 'Vert Open', 'Vert Close',
    ],
    '🌬️ Slice / Wind': [
        'HLSlice', 'HRSlice', 'VUSlice', 'VDSlice',
        'HLWind', 'HRWind', 'VUWind', 'VDWind',
    ],
    '✨ Effects': [
        'Pixelize', 'Zoom In', 'HBlur', 'Distance',
        'SqueezeH', 'SqueezeV', 'Diag TL', 'Diag TR', 'Diag BL', 'Diag BR',
    ],
} as const

/**
 * TRANSITIONS_OUT — Ending/exit transitions.
 */
export const TRANSITIONS_OUT = {
    '── Cơ bản ──': ['None'],
    '🎬 Fade Out': [
        'Fade Black', 'Fade White', 'Fadegrays', 'FadeSlow', 'Fade to Black',
    ],
    '⭕ Shape Close': ['Circle Close', 'Rect Crop'],
    '🚪 Door Close': ['Horz Close', 'Vert Close'],
    '✨ Effects': ['Pixelize', 'HBlur', 'Distance'],
} as const

// ── Backward compat ──
export const TRANSITION_GROUPS = TRANSITIONS_IN

// ── Output resolution presets ──
export const FINAL_OUTPUT_OPTIONS = [
    { label: '16:9 (1920×1080)', width: 1920, height: 1080 },
    { label: '16:9 (1280×720)', width: 1280, height: 720 },
    { label: '9:16 (1080×1920)', width: 1080, height: 1920 },
    { label: '9:16 (720×1280)', width: 720, height: 1280 },
] as const

// ── Video/Audio extensions ──
export const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']
export const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']

// ── Merge config type ──
export interface MergeConfig {
    outputFolder: string
    transitionIn: string
    transitionOut: string
    transitionDuration: number
    finalOutput: string
    musicPath: string
    deleteOriginals: boolean
    applyHDR: boolean
}
