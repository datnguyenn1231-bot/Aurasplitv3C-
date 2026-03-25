/**
 * transitions.ts — Shared xfade transition module.
 * Ported from v1 transitions.py + OpenCut/Omniclip reference.
 *
 * Used by: AutoMERGE, Reup Video, and any future feature needing transitions.
 *
 * Exports:
 *   XFADE_MAP            — UI label → FFmpeg xfade name
 *   TRANSITION_GROUP_MAP  — Group name → transitions + description
 *   resolveTransition()  — Resolve UI label → FFmpeg name (supports Random + Random [Group])
 *   isCustomTransition() — Check if transition needs custom rendering
 *   TRANSITIONS_IN       — Groups for IN dropdown
 *   TRANSITIONS_OUT      — Groups for OUT dropdown
 */

// ── UI Label → FFmpeg xfade name ────────────
export const XFADE_MAP: Record<string, string> = {
    // Documentary / Pro
    'Dissolve': 'dissolve', 'Fade': 'fade', 'Fade Black': 'fadeblack',
    'Fade White': 'fadewhite', 'Fadegrays': 'fadegrays',
    // Smooth (eased)
    'Smooth Left': 'smoothleft', 'Smooth Right': 'smoothright',
    'Smooth Up': 'smoothup', 'Smooth Down': 'smoothdown',
    // Wipe
    'Wipe Left': 'wipeleft', 'Wipe Right': 'wiperight',
    'Wipe Up': 'wipeup', 'Wipe Down': 'wipedown',
    'Wipe TL': 'wipetl', 'Wipe TR': 'wipetr',
    'Wipe BL': 'wipebl', 'Wipe BR': 'wipebr',
    // Slide
    'Slide Left': 'slideleft', 'Slide Right': 'slideright',
    'Slide Up': 'slideup', 'Slide Down': 'slidedown',
    // Cover / Reveal
    'Cover Left': 'coverleft', 'Cover Right': 'coverright',
    'Cover Up': 'coverup', 'Cover Down': 'coverdown',
    'Reveal Left': 'revealleft', 'Reveal Right': 'revealright',
    'Reveal Up': 'revealup', 'Reveal Down': 'revealdown',
    // Shape
    'Circle Open': 'circleopen', 'Circle Close': 'circleclose',
    'Circle Crop': 'circlecrop', 'Rect Crop': 'rectcrop', 'Radial': 'radial',
    // Barn Door
    'Horz Open': 'horzopen', 'Horz Close': 'horzclose',
    'Vert Open': 'vertopen', 'Vert Close': 'vertclose',
    // Slice / Wind
    'HLSlice': 'hlslice', 'HRSlice': 'hrslice',
    'VUSlice': 'vuslice', 'VDSlice': 'vdslice',
    'HLWind': 'hlwind', 'HRWind': 'hrwind',
    'VUWind': 'vuwind', 'VDWind': 'vdwind',
    // Effects
    'Pixelize': 'pixelize', 'Zoom In': 'zoomin', 'HBlur': 'hblur',
    'Distance': 'distance', 'SqueezeH': 'squeezeh', 'SqueezeV': 'squeezev',
    'FadeFast': 'fadefast', 'FadeSlow': 'fadeslow',
    'Diag TL': 'diagtl', 'Diag TR': 'diagtr',
    'Diag BL': 'diagbl', 'Diag BR': 'diagbr',
}

/** All FFmpeg xfade transition names */
export const XFADE_ALL = Object.values(XFADE_MAP)

/** All UI labels (for dropdowns) */
export const XFADE_LABELS = Object.keys(XFADE_MAP)

// ══════════════════════════════════════════════
// Custom transitions (not xfade, use filter chains)
// ══════════════════════════════════════════════

export const CUSTOM_TRANSITIONS = new Set(['Fade to Black'])

export function isCustomTransition(name: string): boolean {
    return CUSTOM_TRANSITIONS.has(name)
}

export interface CustomTransitionConfig {
    fadeOutDuration: number
    blackHoldDuration: number
    fadeInDuration: number
}

export const FADE_TO_BLACK_CONFIG: CustomTransitionConfig = {
    fadeOutDuration: 0.5,
    blackHoldDuration: 0.2,
    fadeInDuration: 0.5,
}

// ══════════════════════════════════════════════
// Transition Groups — with descriptions + use-cases
// ══════════════════════════════════════════════

export interface TransitionGroupInfo {
    label: string
    emoji: string
    items: string[]        // UI labels of transitions in this group
    description: string    // Mô tả tác dụng
    useCase: string        // Dùng cho loại video nào
}

/**
 * Full group definitions with descriptions + use-cases.
 * Used for both UI display and Random-by-Group logic.
 */
export const TRANSITION_GROUP_MAP: TransitionGroupInfo[] = [
    {
        label: 'Documentary / Pro',
        emoji: '🎬',
        items: ['Dissolve', 'Fade', 'Fade Black', 'Fade White',
            'Fadegrays', 'FadeFast', 'FadeSlow', 'Fade to Black'],
        description: 'Fade mờ dần — chuyên nghiệp, tinh tế',
        useCase: 'Phim tài liệu, interview, review sản phẩm, Reup video, content giáo dục',
    },
    {
        label: 'Smooth',
        emoji: '🌊',
        items: ['Smooth Left', 'Smooth Right', 'Smooth Up', 'Smooth Down'],
        description: 'Trượt mượt mà với easing — cảm giác sang trọng',
        useCase: 'Vlog, travel video, lifestyle, food review, content mượt mà',
    },
    {
        label: 'Wipe',
        emoji: '🧹',
        items: ['Wipe Left', 'Wipe Right', 'Wipe Up', 'Wipe Down',
            'Wipe TL', 'Wipe TR', 'Wipe BL', 'Wipe BR'],
        description: 'Quét sạch cảnh cũ — năng động, dứt khoát',
        useCase: 'News, sports highlight, gaming montage, content tin tức, so sánh',
    },
    {
        label: 'Slide',
        emoji: '📦',
        items: ['Slide Left', 'Slide Right', 'Slide Up', 'Slide Down'],
        description: 'Trượt nhanh video mới đè lên cũ — gọn gàng',
        useCase: 'Social media (Reels, TikTok, Shorts), slideshow ảnh, portfolio',
    },
    {
        label: 'Cover',
        emoji: '🎭',
        items: ['Cover Left', 'Cover Right', 'Cover Up', 'Cover Down'],
        description: 'Video mới phủ/đè lên video cũ — mạnh mẽ',
        useCase: 'Presentation, giới thiệu sản phẩm, unboxing, before/after',
    },
    {
        label: 'Reveal',
        emoji: '👁️',
        items: ['Reveal Left', 'Reveal Right', 'Reveal Up', 'Reveal Down'],
        description: 'Video cũ rút đi lộ ra video mới — bất ngờ',
        useCase: 'Reveal sản phẩm, surprise content, transformation video',
    },
    {
        label: 'Shape',
        emoji: '⭕',
        items: ['Circle Open', 'Circle Close', 'Circle Crop', 'Rect Crop', 'Radial'],
        description: 'Chuyển cảnh bằng hình học (tròn, vuông, tia xoay)',
        useCase: 'Music video, cinematic, creative content, intro/outro',
    },
    {
        label: 'Barn Door',
        emoji: '🚪',
        items: ['Horz Open', 'Horz Close', 'Vert Open', 'Vert Close'],
        description: 'Mở/đóng cửa chia đôi — style TV cổ điển',
        useCase: 'Talk show, gameshow, TV-style, retro content',
    },
    {
        label: 'Slice / Wind',
        emoji: '🌬️',
        items: ['HLSlice', 'HRSlice', 'VUSlice', 'VDSlice',
            'HLWind', 'HRWind', 'VUWind', 'VDWind'],
        description: 'Cắt lát hoặc thổi gió — tốc độ cao, kịch tính',
        useCase: 'Action, sports, gaming, EDM/music video, content tốc độ cao',
    },
    {
        label: 'Effects',
        emoji: '✨',
        items: ['Pixelize', 'Zoom In', 'HBlur', 'Distance',
            'SqueezeH', 'SqueezeV', 'Diag TL', 'Diag TR', 'Diag BL', 'Diag BR'],
        description: 'Hiệu ứng đặc biệt (zoom, blur, pixel, chéo)',
        useCase: 'Meme, entertainment, viral content, creative edit, comedy',
    },
]

// ══════════════════════════════════════════════
// Beautiful / Ugly classification (for "Random All")
// ══════════════════════════════════════════════

export const BEAUTIFUL: string[] = [
    'fade', 'fadeblack', 'fadewhite', 'dissolve',
    'circleopen', 'circleclose', 'radial', 'zoomin',
    'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
    'wipeleft', 'wiperight', 'slideleft', 'slideright',
]

export const UGLY = new Set([
    'hblur', 'distance', 'pixelize', 'rectcrop', 'squeezeh', 'squeezev',
])

// ══════════════════════════════════════════════
// Resolve & Random (supports group-specific random)
// ══════════════════════════════════════════════

/**
 * Resolve UI label → FFmpeg xfade name.
 *
 * Supports:
 *   'None'             → ''  (no transition)
 *   'Random'           → weighted random from all (exclude ugly)
 *   'Random: Documentary / Pro' → random from Documentary group
 *   'Random: Smooth'   → random from Smooth group
 *   'Dissolve'         → 'dissolve'
 *   'Fade to Black'    → 'Fade to Black' (custom, handled separately)
 */
export function resolveTransition(uiName: string): string {
    if (uiName === 'None') return ''
    if (uiName === 'Random') return getRandomTransition()

    // Random by Group: "Random: GroupName"
    if (uiName.startsWith('Random: ')) {
        const groupName = uiName.replace('Random: ', '')
        return getRandomFromGroup(groupName)
    }

    if (isCustomTransition(uiName)) return uiName
    return XFADE_MAP[uiName] || 'fade'
}

/** Weighted random from ALL transitions (exclude ugly, beautiful 3×) */
export function getRandomTransition(): string {
    const pool: string[] = []
    for (const t of XFADE_ALL) {
        if (UGLY.has(t)) continue
        if (BEAUTIFUL.includes(t)) {
            pool.push(t, t, t)
        } else {
            pool.push(t)
        }
    }
    if (pool.length === 0) return 'fade'
    return pool[Math.floor(Math.random() * pool.length)]
}

/** Random from a specific group (excludes custom transitions) */
export function getRandomFromGroup(groupLabel: string): string {
    const group = TRANSITION_GROUP_MAP.find(g => g.label === groupLabel)
    if (!group || group.items.length === 0) return getRandomTransition()

    // Filter out custom transitions — they can't be used in xfade chains
    const validItems = group.items.filter(item => !isCustomTransition(item))
    if (validItems.length === 0) return getRandomTransition()

    // Pick random item from valid items
    const item = validItems[Math.floor(Math.random() * validItems.length)]
    return XFADE_MAP[item] || 'fade'
}

// ══════════════════════════════════════════════
// Transition IN / OUT Groups (for UI dropdowns)
// ══════════════════════════════════════════════

/**
 * Build the "Random" group options for the dropdown.
 * Includes "Random (All)" + "Random: [Group]" for each group.
 */
export const RANDOM_OPTIONS = [
    'Random',
    ...TRANSITION_GROUP_MAP.map(g => `Random: ${g.label}`),
]

/**
 * TRANSITION IN — Clip-to-clip transitions.
 * Controls how the NEXT scene enters.
 */
export const TRANSITIONS_IN = [
    {
        label: '── Cơ bản ──',
        items: ['None'],
    },
    {
        label: '🎲 Ngẫu Nhiên',
        items: RANDOM_OPTIONS,
    },
    ...TRANSITION_GROUP_MAP.map(g => ({
        label: `${g.emoji} ${g.label}`,
        items: g.items,
    })),
]

/**
 * TRANSITION OUT — Ending/exit transitions.
 * Controls how the video fades out at the end.
 */
export const TRANSITIONS_OUT = [
    {
        label: '── Cơ bản ──',
        items: ['None'],
    },
    {
        label: '🎬 Fade Out (Mờ dần)',
        items: ['Fade Black', 'Fade White', 'Fadegrays', 'FadeSlow', 'Fade to Black'],
    },
    {
        label: '⭕ Shape Close (Đóng)',
        items: ['Circle Close', 'Rect Crop'],
    },
    {
        label: '🚪 Door Close (Đóng cửa)',
        items: ['Horz Close', 'Vert Close'],
    },
    {
        label: '✨ Effects',
        items: ['Pixelize', 'HBlur', 'Distance'],
    },
]

// ── Backward compat ──
export const TRANSITION_GROUPS = TRANSITIONS_IN
