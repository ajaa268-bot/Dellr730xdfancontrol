# register-service.ps1
# Script to install the Dell Fan Control Server as a Windows Scheduled Task (runs silently in background at startup)

$scriptPath = Join-Path $PSScriptRoot "server.ps1"
$taskName = "DellFanControlServer"

# Ensure we are running as Admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "This script requires Administrator privileges to register startup tasks."
    Write-Host "Please restart PowerShell as Administrator and run this script again." -ForegroundColor Yellow
    Exit
}

Write-Host "Registering '$taskName' to run silently at system startup..." -ForegroundColor Cyan

# Action: launch powershell.exe hidden and load server.ps1
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

# Trigger: at startup (Boot)
$trigger = New-ScheduledTaskTrigger -AtStartup

# Settings: run with highest privileges, don't stop task, allow running on battery
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Principal: SYSTEM account (highest local privilege, runs without user session)
$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Register scheduled task
try {
    # Check if task already exists and unregister it first
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Write-Host "Existing task found. Overwriting..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    
    Register-ScheduledTask -TaskPath "\" -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
    
    Write-Host "Success! The background task '$taskName' has been registered." -ForegroundColor Green
    Write-Host "It will run automatically when the machine starts." -ForegroundColor Green
    
    # Suggest starting it now
    $startNow = Read-Host "Would you like to start the server task now? (Y/N)"
    if ($startNow -eq "Y" -or $startNow -eq "y") {
        Start-ScheduledTask -TaskName $taskName
        Write-Host "Background server task started successfully!" -ForegroundColor Green
        Write-Host "You can access the dashboard at: http://localhost:3000/" -ForegroundColor Green
    }
} catch {
    Write-Error "Failed to register scheduled task: $_"
}
