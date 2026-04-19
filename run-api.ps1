# Run Echo API from the echo folder. Usage: .\run-api.ps1
# Stops any running Echo.Api first, then starts the API.
$apiDir = Join-Path $PSScriptRoot "api"
& (Join-Path $apiDir "stop-api.ps1")
Set-Location -Path $apiDir
dotnet run
 
  