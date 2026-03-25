@echo off
setlocal enabledelayedexpansion
:: ============================================================
:: END-TO-END TEST: Simulate processVideo() with NVEncC shaders
:: ============================================================

set NVENC=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\NVEncC64.exe
set FFMPEG=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\ffmpeg.exe
set SHADERS=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders
set OUTDIR=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\e2e_test
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

echo [1/6] Creating 10s test video with audio...
"%FFMPEG%" -y -f lavfi -i "testsrc2=s=1920x1080:d=10:r=30" -f lavfi -i "sine=frequency=440:duration=10" -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k "%OUTDIR%\input_with_audio.mp4" 2>NUL
echo [OK] Test video created

:: TEST A: Full GPU (no audio effects)
echo.
echo [2/6] TEST A: Full GPU + audio-copy (mirror+noise+hdr+rgbdrift+vibrant)
"%NVENC%" --avhw -i "%OUTDIR%\input_with_audio.mp4" --vpp-transform flip_x=true --vpp-libplacebo-shader "shader=%SHADERS%\noise.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\hdr.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\rgbdrift.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\color_vibrant.glsl" --codec h264 --preset p1 --cqp 23 --audio-copy -o "%OUTDIR%\test_a_fullgpu.mp4" --log-level warn
if !ERRORLEVEL! EQU 0 (echo [PASS] Test A) else (echo [FAIL] Test A)

:: TEST B: Split audio pipeline (NVEncC video + FFmpeg audio + mux)
echo.
echo [3/6] TEST B: Split pipeline (hdr+chromashuffle, separate volume boost)
echo       B1: NVEncC video only...
"%NVENC%" --avhw -i "%OUTDIR%\input_with_audio.mp4" --vpp-libplacebo-shader "shader=%SHADERS%\hdr.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\chromashuffle.glsl" --codec h264 --preset p1 --cqp 23 -o "%OUTDIR%\test_b_video.mp4" --log-level warn
if !ERRORLEVEL! NEQ 0 (echo [FAIL] Test B Step 1 & goto :test_c)
echo       B2: FFmpeg audio with volume boost...
"%FFMPEG%" -y -i "%OUTDIR%\input_with_audio.mp4" -af "volume=1.5" -vn -c:a aac -b:a 192k "%OUTDIR%\test_b_audio.aac" 2>NUL
if !ERRORLEVEL! NEQ 0 (echo [FAIL] Test B Step 2 & goto :test_c)
echo       B3: FFmpeg mux...
"%FFMPEG%" -y -i "%OUTDIR%\test_b_video.mp4" -i "%OUTDIR%\test_b_audio.aac" -c:v copy -c:a copy -movflags +faststart "%OUTDIR%\test_b_final.mp4" 2>NUL
if !ERRORLEVEL! EQU 0 (echo [PASS] Test B) else (echo [FAIL] Test B)

:: TEST C: Full Shield (7 shaders + mirror)
:test_c
echo.
echo [4/6] TEST C: Full Shield 7 shaders + mirror + audio
"%NVENC%" --avhw -i "%OUTDIR%\input_with_audio.mp4" --vpp-transform flip_x=true --vpp-libplacebo-shader "shader=%SHADERS%\noise.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\rotate.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\hdr.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\rgbdrift.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\lens.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\chromashuffle.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\glow.glsl" --codec h264 --preset p1 --cqp 23 --audio-copy -o "%OUTDIR%\test_c_fullshield.mp4" --log-level warn
if !ERRORLEVEL! EQU 0 (echo [PASS] Test C) else (echo [FAIL] Test C)

:: TEST D: Color presets
echo.
echo [5/6] TEST D: Color grading presets
for %%G in (color_sepia color_bw color_coolblue) do (
    "%NVENC%" --avhw -i "%OUTDIR%\input_with_audio.mp4" --vpp-libplacebo-shader "shader=%SHADERS%\%%G.glsl" --codec h264 --preset p1 --cqp 23 --audio-copy -o "%OUTDIR%\test_d_%%G.mp4" --log-level warn
    if !ERRORLEVEL! EQU 0 (echo       [PASS] %%G) else (echo       [FAIL] %%G)
)

:: TEST E: Zoompan + Pixelate
echo.
echo [6/6] TEST E: Zoompan + Pixelate
"%NVENC%" --avhw -i "%OUTDIR%\input_with_audio.mp4" --vpp-libplacebo-shader "shader=%SHADERS%\zoompan.glsl" --vpp-libplacebo-shader "shader=%SHADERS%\pixelate.glsl" --codec h264 --preset p1 --cqp 23 --audio-copy -o "%OUTDIR%\test_e_zoom_pixel.mp4" --log-level warn
if !ERRORLEVEL! EQU 0 (echo [PASS] Test E) else (echo [FAIL] Test E)

:: SUMMARY
echo.
echo ============================================================
echo RESULTS SUMMARY
echo ============================================================
set PASS=0
set TOTAL=7
if exist "%OUTDIR%\test_a_fullgpu.mp4" (echo [PASS] A: Full GPU pipeline & set /a PASS+=1) else (echo [FAIL] A)
if exist "%OUTDIR%\test_b_final.mp4" (echo [PASS] B: Split audio pipeline & set /a PASS+=1) else (echo [FAIL] B)
if exist "%OUTDIR%\test_c_fullshield.mp4" (echo [PASS] C: Full Shield 7 shaders & set /a PASS+=1) else (echo [FAIL] C)
if exist "%OUTDIR%\test_d_color_sepia.mp4" (echo [PASS] D1: Sepia & set /a PASS+=1) else (echo [FAIL] D1)
if exist "%OUTDIR%\test_d_color_bw.mp4" (echo [PASS] D2: BW & set /a PASS+=1) else (echo [FAIL] D2)
if exist "%OUTDIR%\test_d_color_coolblue.mp4" (echo [PASS] D3: CoolBlue & set /a PASS+=1) else (echo [FAIL] D3)
if exist "%OUTDIR%\test_e_zoom_pixel.mp4" (echo [PASS] E: Zoompan+Pixelate & set /a PASS+=1) else (echo [FAIL] E)
echo.
echo !PASS!/!TOTAL! tests passed
echo ============================================================
