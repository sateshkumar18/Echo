# Run Echo AI Worker (core only – no transcription).
# Use the project-root .venv only (do not create venv in worker/). From project root run: .\run-worker.ps1
# If running from worker folder: activate root .venv first, then: .\run-worker-core.ps1
# First time: from root: .\.venv\Scripts\Activate.ps1 ; cd worker ; pip install -r requirements-core.txt
Set-Location -Path $PSScriptRoot
if (-not (Test-Path "requirements-core.txt")) { Write-Error "Run from worker folder or use: cd worker; .\run-worker-core.ps1"; exit 1 }
python app.py
