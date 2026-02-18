# Stop any running Echo.Api processes so you can rebuild. Usage: .\stop-api.ps1
Get-Process -Name "Echo.Api" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Echo.Api processes stopped (if any were running)."
