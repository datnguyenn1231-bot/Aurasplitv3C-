# ==================================================
#   AuraSplit v3 - Full Build Script
#   Run: .\build.ps1
# ==================================================

$ErrorActionPreference = "Stop"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AuraSplit v3 - FULL BUILD PIPELINE"     -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -- Config --
$ProjectRoot   = $PSScriptRoot
$EngineExe     = "$ProjectRoot\engine\build\Release\aura_engine.exe"
$InnoSetup     = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
$InstallerISS  = "$ProjectRoot\installer_v3.iss"
$OutputExe     = "$ProjectRoot\dist\AuraSplit_Setup_v3.exe"

Set-Location $ProjectRoot

# ==================================================
# Step 1: TypeScript Check
# ==================================================
Write-Host "[1/5] Checking TypeScript..." -ForegroundColor Yellow
npx vue-tsc --noEmit 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [FAIL] TypeScript errors found! Run 'npx vue-tsc --noEmit' to see details." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] TypeScript OK" -ForegroundColor Green

# ==================================================
# Step 2: Vite Build + Electron Builder
# ==================================================
Write-Host "[2/5] Building app (Vite + Obfuscate + Electron Builder)..." -ForegroundColor Yellow
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [FAIL] Build failed! Check npm run build output." -ForegroundColor Red
    exit 1
}

# Output dir is always release/0.0.0/win-unpacked
$UnpackedDir = "$ProjectRoot\release\0.0.0\win-unpacked"
$BinariesDir = "$UnpackedDir\resources\binaries"

Write-Host "  [OK] Build OK -> $UnpackedDir" -ForegroundColor Green

# ==================================================
# Step 3: Copy C++ Engine
# ==================================================
Write-Host "[3/5] Copying AuraEngine..." -ForegroundColor Yellow
if (Test-Path $EngineExe) {
    Copy-Item $EngineExe "$BinariesDir\aura_engine.exe" -Force
    $size = [math]::Round((Get-Item $EngineExe).Length / 1MB, 1)
    Write-Host "  [OK] aura_engine.exe (${size} MB) -> binaries/" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Engine not found at $EngineExe - skipping (using bundled version)" -ForegroundColor DarkYellow
}

# ==================================================
# Step 4: Verify all required DLLs exist
# ==================================================
Write-Host "[4/5] Verifying DLLs..." -ForegroundColor Yellow
$requiredDLLs = @(
    "avcodec-62.dll", "avdevice-62.dll", "avfilter-11.dll",
    "avformat-62.dll", "avutil-60.dll", "swresample-6.dll",
    "swscale-9.dll", "libass-9.dll", "cudart64_110.dll",
    "libplacebo-351.dll"
)
$missing = @()
foreach ($dll in $requiredDLLs) {
    $dllPath = "$BinariesDir\$dll"
    if (Test-Path $dllPath) {
        $s = [math]::Round((Get-Item $dllPath).Length / 1MB, 1)
        Write-Host "  [OK] $dll (${s} MB)" -ForegroundColor DarkGreen
    } else {
        $missing += $dll
        Write-Host "  [MISSING] $dll" -ForegroundColor Red
    }
}
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "  [STOP] $($missing.Count) DLL(s) missing! Fix electron-builder.json5 extraResources." -ForegroundColor Red
    Write-Host "  Missing: $($missing -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] All $($requiredDLLs.Count) DLLs verified!" -ForegroundColor Green

# ==================================================
# Step 5: Inno Setup Compiler
# ==================================================
Write-Host "[5/5] Building installer (Inno Setup)..." -ForegroundColor Yellow
if (!(Test-Path $InnoSetup)) {
    Write-Host "  [FAIL] Inno Setup not found at: $InnoSetup" -ForegroundColor Red
    exit 1
}

# Auto-update SourceDir in .iss file to match current build output
$issContent = Get-Content $InstallerISS -Raw
$issContent = $issContent -replace '#define SourceDir ".*"', "#define SourceDir `"$UnpackedDir`""
Set-Content $InstallerISS $issContent -NoNewline

& $InnoSetup $InstallerISS 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [FAIL] Inno Setup failed!" -ForegroundColor Red
    exit 1
}

# Restore SourceDir to default
$issContent = Get-Content $InstallerISS -Raw
$defaultUnpacked = "$ProjectRoot\release\0.0.0\win-unpacked"
$issContent = $issContent -replace '#define SourceDir ".*"', "#define SourceDir `"$defaultUnpacked`""
Set-Content $InstallerISS $issContent -NoNewline

# ==================================================
# Done!
# ==================================================
$sw.Stop()
$elapsed = $sw.Elapsed
$exeSize = [math]::Round((Get-Item $OutputExe).Length / 1MB)

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BUILD COMPLETE!" -ForegroundColor Green
Write-Host "  Output: $OutputExe" -ForegroundColor Green
Write-Host "  Size: ${exeSize} MB" -ForegroundColor Green
Write-Host "  Time: $($elapsed.Minutes)m $($elapsed.Seconds)s" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
