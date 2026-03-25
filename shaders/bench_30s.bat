@echo off
set FFMPEG=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\ffmpeg.exe
set NVENC=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\NVEncC64.exe
set INPUT=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\bench_input_30s.mp4
set SHADERS=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders
set OUTDIR=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders

echo ============================================
echo BENCHMARK: 30-second 1080p video
echo ============================================

echo.
echo --- [A] NVEncC + Full Shield (6 GPU shaders + mirror) ---
echo START: %TIME%
"%FFMPEG%" -y -i "%INPUT%" -f yuv4mpegpipe -pix_fmt yuv420p pipe:1 2>NUL | "%NVENC%" --y4m -i - ^
  --vpp-transform flip_x=true ^
  --vpp-libplacebo-shader "shader=%SHADERS%\noise.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\hdr.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\rgbdrift.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\chromashuffle.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\lens.glsl" ^
  --vpp-libplacebo-shader "shader=%SHADERS%\color_vibrant.glsl" ^
  --codec h264 --preset p1 --cqp 23 ^
  -o "%OUTDIR%\bench_nvenc_30s.mp4"
echo END: %TIME%
if %ERRORLEVEL% EQU 0 (
    echo [A] NVEncC FULL SHIELD: SUCCESS
    for %%A in ("%OUTDIR%\bench_nvenc_30s.mp4") do echo    Size: %%~zA bytes
) else (
    echo [A] NVEncC FULL SHIELD: FAILED
)

echo.
echo --- [B] FFmpeg CPU + same filters + CPU encode (libx264) ---
echo START: %TIME%
"%FFMPEG%" -y -i "%INPUT%" ^
  -vf "hflip,noise=alls=10:allf=t+u,eq=contrast=1.10:saturation=1.10:brightness=0.010,unsharp=5:5:0.9:3:3:0.5,rgbashift=rh=1:rv=-1:gh=0:gv=0:bh=-1:bv=1,colorchannelmixer=rr=0.98:rg=0.01:rb=0.01:gr=0.01:gg=0.98:gb=0.01:br=0.01:bg=0.01:bb=0.98,lenscorrection=cx=0.5:cy=0.5:k1=-0.05:k2=-0.03,eq=brightness=0.15:contrast=1.08:saturation=1.22,vibrance=intensity=0.15,unsharp=5:5:0.8:5:5:0.0" ^
  -c:v libx264 -preset fast -crf 23 ^
  "%OUTDIR%\bench_ffmpeg_cpu_30s.mp4" 2>NUL
echo END: %TIME%
if %ERRORLEVEL% EQU 0 (
    echo [B] FFmpeg CPU: SUCCESS
    for %%A in ("%OUTDIR%\bench_ffmpeg_cpu_30s.mp4") do echo    Size: %%~zA bytes
) else (
    echo [B] FFmpeg CPU: FAILED
)

echo.
echo --- [C] FFmpeg + same filters + GPU encode (h264_nvenc) ---
echo START: %TIME%
"%FFMPEG%" -y -i "%INPUT%" ^
  -vf "hflip,noise=alls=10:allf=t+u,eq=contrast=1.10:saturation=1.10:brightness=0.010,unsharp=5:5:0.9:3:3:0.5,rgbashift=rh=1:rv=-1:gh=0:gv=0:bh=-1:bv=1,colorchannelmixer=rr=0.98:rg=0.01:rb=0.01:gr=0.01:gg=0.98:gb=0.01:br=0.01:bg=0.01:bb=0.98,lenscorrection=cx=0.5:cy=0.5:k1=-0.05:k2=-0.03,eq=brightness=0.15:contrast=1.08:saturation=1.22,vibrance=intensity=0.15,unsharp=5:5:0.8:5:5:0.0" ^
  -c:v h264_nvenc -preset p1 -cq 23 ^
  "%OUTDIR%\bench_ffmpeg_gpu_30s.mp4" 2>NUL
echo END: %TIME%
if %ERRORLEVEL% EQU 0 (
    echo [C] FFmpeg + GPU encode: SUCCESS
    for %%A in ("%OUTDIR%\bench_ffmpeg_gpu_30s.mp4") do echo    Size: %%~zA bytes
) else (
    echo [C] FFmpeg + GPU encode: FAILED
)

echo.
echo ============================================
echo BENCHMARK COMPLETE
echo ============================================
