@echo off
set FFMPEG=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\ffmpeg.exe
set NVENC=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\binaries\NVEncC64.exe
set INPUT=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\test_input.mp4
set OUTPUT=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\test_output_invert.mp4
set SHADER=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\test_invert.glsl

echo === TEST 1: Single shader (invert) via Y4M pipe ===
"%FFMPEG%" -y -i "%INPUT%" -f yuv4mpegpipe -pix_fmt yuv420p pipe:1 2>NUL | "%NVENC%" --y4m -i - --vpp-libplacebo-shader "shader=%SHADER%" --codec h264 --preset p1 --cqp 23 -o "%OUTPUT%"
if %ERRORLEVEL% EQU 0 (
    echo === SUCCESS: Shader test passed! ===
) else (
    echo === FAILED: Exit code %ERRORLEVEL% ===
)

echo.
echo === TEST 2: Chain 2 shaders (noise + hdr) via Y4M pipe ===
set SHADER_NOISE=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\test_noise.glsl
set SHADER_HDR=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\test_hdr.glsl
set OUTPUT2=c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2\shaders\test_output_chain.mp4

"%FFMPEG%" -y -i "%INPUT%" -f yuv4mpegpipe -pix_fmt yuv420p pipe:1 2>NUL | "%NVENC%" --y4m -i - --vpp-libplacebo-shader "shader=%SHADER_NOISE%" --vpp-libplacebo-shader "shader=%SHADER_HDR%" --codec h264 --preset p1 --cqp 23 -o "%OUTPUT2%"
if %ERRORLEVEL% EQU 0 (
    echo === SUCCESS: Chain shader test passed! ===
) else (
    echo === FAILED: Exit code %ERRORLEVEL% ===
)
