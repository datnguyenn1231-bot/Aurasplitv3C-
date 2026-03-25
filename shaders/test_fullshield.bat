@echo off
set FFMPEG=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\ffmpeg.exe
set NVENC=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\NVEncC64.exe
set INPUT=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\test_input.mp4
set SHADERS=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders
set OUTDIR=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders

echo ============================================
echo FULL SHIELD TEST: Chain ALL shaders
echo ============================================

echo.
echo --- Test: Full Shield (noise + rotate + hdr + rgbdrift + lens + chromashuffle + glow) ---
"%FFMPEG%" -y -i "%INPUT%" -f yuv4mpegpipe -pix_fmt yuv420p pipe:1 2>NUL | "%NVENC%" --y4m -i - ^
  --vpp-libplacebo-shader "shader=%SHADERS%\noise.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\rotate.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\hdr.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\rgbdrift.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\lens.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\chromashuffle.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\glow.glsl" ^
  --vpp-transform flip_x=true ^
  --codec h264 --preset p1 --cqp 23 ^
  -o "%OUTDIR%\test_fullshield.mp4"

if %ERRORLEVEL% EQU 0 (
    echo === FULL SHIELD TEST: SUCCESS ===
    for %%A in ("%OUTDIR%\test_fullshield.mp4") do echo Output size: %%~zA bytes
) else (
    echo === FULL SHIELD TEST: FAILED (exit code %ERRORLEVEL%) ===
)

echo.
echo --- Test: Color grading (sepia) ---
"%FFMPEG%" -y -i "%INPUT%" -f yuv4mpegpipe -pix_fmt yuv420p pipe:1 2>NUL | "%NVENC%" --y4m -i - ^
  --vpp-libplacebo-shader "shader=%SHADERS%\color_sepia.glsl" ^
  --codec h264 --preset p1 --cqp 23 ^
  -o "%OUTDIR%\test_sepia.mp4"

if %ERRORLEVEL% EQU 0 (
    echo === SEPIA TEST: SUCCESS ===
) else (
    echo === SEPIA TEST: FAILED ===
)

echo.
echo ============================================
echo BENCHMARK: Full Shield NVEncC vs FFmpeg CPU
echo ============================================
echo.
echo --- NVEncC Full Shield (timed) ---
echo %TIME%
"%FFMPEG%" -y -i "%INPUT%" -f yuv4mpegpipe -pix_fmt yuv420p pipe:1 2>NUL | "%NVENC%" --y4m -i - ^
  --vpp-libplacebo-shader "shader=%SHADERS%\noise.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\hdr.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\rgbdrift.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\chromashuffle.glsl" ^
  --vpp-transform flip_x=true ^
  --codec h264 --preset p1 --cqp 23 ^
  -o "%OUTDIR%\bench_nvenc.mp4"
echo %TIME%

echo.
echo --- FFmpeg CPU equivalent (timed) ---
echo %TIME%
"%FFMPEG%" -y -i "%INPUT%" -vf "hflip,noise=alls=10:allf=t+u,eq=contrast=1.10:saturation=1.10:brightness=0.010,unsharp=5:5:0.9:3:3:0.5,rgbashift=rh=1:rv=-1:gh=0:gv=0:bh=-1:bv=1,colorchannelmixer=rr=0.98:rg=0.01:rb=0.01:gr=0.01:gg=0.98:gb=0.01:br=0.01:bg=0.01:bb=0.98" -c:v h264_nvenc -preset p1 -cq 23 "%OUTDIR%\bench_ffmpeg.mp4" 2>NUL
echo %TIME%

echo.
echo ============================================
echo ALL TESTS COMPLETE
echo ============================================
