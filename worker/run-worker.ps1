# Run Echo AI Worker. Use the project-root .venv (where Whisper is installed).
# Run from project root instead: cd .. ; .\run-worker.ps1
$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location -Path $rootDir
& (Join-Path $rootDir "run-worker.ps1")
