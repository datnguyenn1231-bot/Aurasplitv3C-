declare module 'libass-wasm' {
    interface SubtitlesOctopusOptions {
        video?: HTMLVideoElement
        canvas?: HTMLCanvasElement
        subUrl?: string
        subContent?: string
        workerUrl?: string
        legacyWorkerUrl?: string
        fonts?: string[]
        availableFonts?: Record<string, string>
        fallbackFont?: string
        lazyFileLoading?: boolean
        timeOffset?: number
        onReady?: () => void
        onError?: (error: any) => void
        debug?: boolean
        renderMode?: 'js-blend' | 'wasm-blend' | 'lossy'
        targetFps?: number
        libassMemoryLimit?: number
        libassGlyphLimit?: number
        prescaleFactor?: number
        prescaleHeightLimit?: number
        maxRenderHeight?: number
        dropAllAnimations?: boolean
    }

    class SubtitlesOctopus {
        constructor(options: SubtitlesOctopusOptions)
        setTrackByUrl(url: string): void
        setTrack(content: string): void
        freeTrack(): void
        dispose(): void
        setCurrentTime(time: number): void
        resize(width?: number, height?: number, top?: number, left?: number): void
    }

    export default SubtitlesOctopus
}
