cmake_minimum_required(VERSION 3.20)
project(aura_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── FFmpeg dev path (BtbN shared build) ──
set(FFMPEG_ROOT "C:/ffmpeg-dev/ffmpeg-master-latest-win64-gpl-shared" CACHE PATH "FFmpeg dev root")

# Include/Link dirs
include_directories("${FFMPEG_ROOT}/include")
link_directories("${FFMPEG_ROOT}/lib")

# ── OpenMP for multi-threaded effects ──
find_package(OpenMP REQUIRED)

# ── CUDA support (optional — GPU-accelerated effects) ──
include(CheckLanguage)
check_language(CUDA)
if(CMAKE_CUDA_COMPILER)
    enable_language(CUDA)
    set(CMAKE_CUDA_STANDARD 17)
    set(CMAKE_CUDA_ARCHITECTURES "75;86;89")  # RTX 20xx (Turing) → RTX 40xx (Ada) — CUDA 13.2 min=75
    add_definitions(-DHAS_CUDA=1)
    message(STATUS "CUDA enabled: ${CMAKE_CUDA_COMPILER_VERSION} (arch ${CMAKE_CUDA_ARCHITECTURES})")
    set(CUDA_SOURCES src/cuda_effects.cu)
    set(CUDA_LIBS CUDA::cudart_static)  # Static link — no cudart DLL needed on target machines!
    find_package(CUDAToolkit REQUIRED)
else()
    message(STATUS "CUDA not found — GPU effects disabled, using CPU fallback")
    set(CUDA_SOURCES)
    set(CUDA_LIBS)
endif()

# ── Source files ──
add_executable(aura_engine
    src/main.cpp
    src/engine.cpp
    src/engine.h
    src/effects.cpp
    src/effects.h
    src/advanced_effects.cpp
    src/advanced_effects.h
    src/autosync.cpp
    src/autosync.h
    src/cutting.cpp
    src/cutting.h
    src/merging.cpp
    src/merging.h
    src/config.h
    src/cuda_effects.h
    src/text_renderer.h
    ${CUDA_SOURCES}
)

# ── Link FFmpeg libs ──
target_link_libraries(aura_engine PRIVATE
    avformat
    avcodec
    avutil
    avfilter
    swscale
    swresample
    OpenMP::OpenMP_CXX
    ${CUDA_LIBS}
)

# ── Copy DLLs to output dir (needed at runtime) ──
file(GLOB FFMPEG_DLLS "${FFMPEG_ROOT}/bin/*.dll")
foreach(DLL ${FFMPEG_DLLS})
    add_custom_command(TARGET aura_engine POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different "${DLL}" "$<TARGET_FILE_DIR:aura_engine>"
    )
endforeach()

# ── Install target ──
install(TARGETS aura_engine DESTINATION bin)
install(FILES ${FFMPEG_DLLS} DESTINATION bin)
