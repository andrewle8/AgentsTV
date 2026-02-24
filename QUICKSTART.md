# Quick Launch (Windows)

Add this function to your PowerShell profile (`$PROFILE`) to start Ollama and AgentsTV together, automatically killing any stale process on the port:

```powershell
function Start-AgentsTV {
    $conn = Get-NetTCPConnection -LocalPort 8420 -ErrorAction SilentlyContinue
    if ($conn) {
        Get-Process -Id $conn.OwningProcess | Stop-Process -Force
        Start-Sleep -Seconds 1
    }
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
    python -m agentstv
}
```

Then run `Start-AgentsTV` from any PowerShell window. To access from other devices on your LAN, add a Windows Firewall rule:

```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="agentstv" dir=in action=allow protocol=TCP localport=8420
```
