# Run Echo worker from the echo folder. Usage: .\run-worker.ps1
# Uses the single root .venv only (no venv/ or worker/venv). Prefers full deps (requirements.txt) for transcript + summary.
$workerDir = Join-Path $PSScriptRoot "worker"
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$reqsFull = Join-Path $workerDir "requirements.txt"
$reqsCore = Join-Path $workerDir "requirements-core.txt"

if (-not (Test-Path $venvPy)) {
    Write-Host "ERROR: No .venv found. Run this first (once):"
    Write-Host "  cd $PSScriptRoot"
    Write-Host "  py -3.12 -m venv .venv"
    Write-Host "  .\.venv\Scripts\Activate.ps1"
    Write-Host "  cd worker"
    Write-Host "  pip install -r requirements.txt"
    Write-Host "  cd .."
    Write-Host "Then run .\run-worker.ps1 again."
    exit 1
}

Set-Location -Path $workerDir
# Prefer full deps (Whisper + Ollama) so transcript and summary work; fallback to core.
if (Test-Path $reqsFull) {
    & $venvPy -m pip install -q -r $reqsFull 2>&1 | Out-Null
}
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $reqsFull)) {
    & $venvPy -m pip install -q -r $reqsCore 2>&1 | Out-Null
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "pip install failed. Recreate .venv with Python 3.12 and install worker deps. See worker\README.md"
    exit 1
}
# Quick check if Whisper can import (optional; app.py will create ROCm dir and retry)
& $venvPy -c "from faster_whisper import WhisperModel" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Note: Whisper check failed in isolation (worker may still load Whisper at runtime)." -ForegroundColor Gray
    Write-Host ""
}
# Suppress Hugging Face warnings (symlinks on Windows; "unauthenticated requests" when no HF_TOKEN)
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
$env:HF_HUB_VERBOSITY = "error"
& $venvPy app.py
