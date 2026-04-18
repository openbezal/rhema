<#
.SYNOPSIS
  One-shot Windows build prerequisites installer for Rhema.

.DESCRIPTION
  Installs LLVM (provides libclang.dll required by bindgen when building
  whisper-rs-sys) and CMake (required by whisper.cpp) via winget, and
  persists LIBCLANG_PATH to the user environment.

  Safe to re-run - each step checks for existing installs and exits early.

  GNU-toolchain alternative (MSYS2/MinGW) is NOT handled by this script.
  Contributors preferring that path should follow the upstream whisper-rs
  README: https://github.com/tazz4843/whisper-rs
#>

$ErrorActionPreference = 'Stop'

function Write-Step   { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok     { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Info   { param($m) Write-Host "    $m" -ForegroundColor Gray }
function Write-Warn2  { param($m) Write-Host "!!  $m" -ForegroundColor Yellow }

function Test-Command {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Find-LibclangDir {
    $candidates = @()
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles 'LLVM\bin')
    }
    if (Test-Command clang) {
        $clang = (Get-Command clang).Source
        $candidates += (Split-Path -Parent $clang)
    }
    foreach ($dir in $candidates) {
        if ($dir -and (Test-Path (Join-Path $dir 'libclang.dll'))) {
            return $dir
        }
    }
    return $null
}

Write-Step 'Preflight: checking winget'
if (-not (Test-Command winget)) {
    Write-Warn2 "winget not found. Install 'App Installer' from the Microsoft Store:"
    Write-Warn2 '  https://apps.microsoft.com/detail/9nblggh4nns1'
    exit 1
}
Write-Ok 'winget available'

Write-Step 'LLVM (provides libclang.dll for bindgen)'
$libclangDir = Find-LibclangDir
if ($libclangDir) {
    Write-Ok "LLVM already installed - libclang.dll at $libclangDir"
} else {
    Write-Info 'Installing LLVM.LLVM via winget...'
    winget install --id LLVM.LLVM -e --accept-source-agreements --accept-package-agreements
    $libclangDir = Find-LibclangDir
    if (-not $libclangDir) {
        Write-Warn2 'LLVM install completed but libclang.dll not found. Check the install manually.'
        exit 1
    }
    Write-Ok "LLVM installed - libclang.dll at $libclangDir"
}

Write-Step 'CMake (required by whisper.cpp)'
if (Test-Command cmake) {
    $cmakeVer = (& cmake --version | Select-Object -First 1)
    Write-Ok "CMake already installed - $cmakeVer"
} else {
    Write-Info 'Installing Kitware.CMake via winget...'
    winget install --id Kitware.CMake -e --accept-source-agreements --accept-package-agreements
    Write-Ok 'CMake installed (open a new shell for it to appear on PATH)'
}

Write-Step 'Persisting LIBCLANG_PATH to user environment'
$currentUserLibclang = [Environment]::GetEnvironmentVariable('LIBCLANG_PATH', 'User')
$needsSet = $true
if ($currentUserLibclang -and (Test-Path (Join-Path $currentUserLibclang 'libclang.dll'))) {
    Write-Ok "LIBCLANG_PATH already set to $currentUserLibclang"
    $needsSet = $false
}
if ($needsSet) {
    [Environment]::SetEnvironmentVariable('LIBCLANG_PATH', $libclangDir, 'User')
    Write-Ok "LIBCLANG_PATH set to $libclangDir (user scope)"
}

Write-Step 'MSVC toolchain (required for linking)'
if (Test-Command cl) {
    Write-Ok 'cl.exe on PATH - MSVC linker available'
} else {
    $pfx86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $vswhere = if ($pfx86) { Join-Path $pfx86 'Microsoft Visual Studio\Installer\vswhere.exe' } else { $null }
    $vsFound = $false
    if ($vswhere -and (Test-Path $vswhere)) {
        $vsInstall = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vsInstall) { $vsFound = $true; Write-Ok "Found VS install with C++ tools at $vsInstall" }
    }
    if (-not $vsFound) {
        Write-Warn2 'No MSVC C++ build tools detected.'
        Write-Warn2 'Install Visual Studio 2022 with the "Desktop development with C++" workload:'
        Write-Warn2 '  https://visualstudio.microsoft.com/downloads/'
        Write-Warn2 'Or install just the Build Tools:'
        Write-Warn2 '  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
    }
}

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host ''
Write-Host 'IMPORTANT: close this terminal and open a new one before running ' -NoNewline
Write-Host '`bun run tauri dev`' -ForegroundColor Yellow -NoNewline
Write-Host ' - setx only affects new shells.'
