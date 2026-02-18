# Free port 5012 (Echo API) so the API can start. Run in PowerShell from the echo folder.
foreach ($port in 5012, 5011) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force
        Write-Host "Stopped process using port $port"
    }
}
Write-Host "Done. You can now run .\run-api.ps1"
