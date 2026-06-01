# Setup Script for Dell Fan Control Fallback & Auto-Start Utility
# Run this script as Administrator.

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Dell iDRAC8 Fan Control Setup Utility" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

# Ensure running as administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Please run this script as Administrator."
    Exit
}

$scriptPath = Join-Path $PSScriptRoot "dell_fan_control.ps1"
$ipmitoolPath = "C:\Program Files\Dell\SysMgt\iDRACTools\IPMI\ipmitool.exe"

# Verify ipmitool exists
if (-not (Test-Path $ipmitoolPath)) {
    Write-Warning "Could not find ipmitool.exe at: $ipmitoolPath"
    $customPath = Read-Host "Please enter the full path to ipmitool.exe (or press Enter to skip and locate later)"
    if ($customPath -and (Test-Path $customPath)) {
        $ipmitoolPath = $customPath
    } else {
        Write-Warning "Setup will continue, but ensure ipmitool.exe is placed in the expected path before starting the task."
    }
}

# 1. Register Fallback Task
Write-Host "Registering DellFanControlFallback task..." -ForegroundColor Yellow
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

try {
    Register-ScheduledTask -TaskName "DellFanControlFallback" -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName "DellFanControlFallback" | Out-Null
    Write-Host "[SUCCESS] Registered and started DellFanControlFallback task successfully." -ForegroundColor Green
} catch {
    Write-Error "Failed to register DellFanControlFallback task: $_"
}

# 2. Optionally Register Auto-Start for a Primary Fan Controller
Write-Host ""
$setupAutoStart = Read-Host "Do you want to configure an executable to auto-start on user logon? (y/n)"
if ($setupAutoStart -eq 'y' -or $setupAutoStart -eq 'yes') {
    $exePath = Read-Host "Enter the full path to the executable (e.g., O:\Temp app\FanController.exe)"
    if ($exePath -and (Test-Path $exePath)) {
        $actionFC = New-ScheduledTaskAction -Execute $exePath
        $triggerFC = New-ScheduledTaskTrigger -AtLogon
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $principalFC = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest

        try {
            Register-ScheduledTask -TaskName "AutoStartFanController" -Action $actionFC -Trigger $triggerFC -Principal $principalFC -Force | Out-Null
            Write-Host "[SUCCESS] Registered AutoStartFanController task successfully for $currentUser." -ForegroundColor Green
        } catch {
            Write-Error "Failed to register AutoStartFanController task: $_"
        }
    } else {
        Write-Warning "Invalid path. Skipping AutoStart setup."
    }
}

Write-Host ""
Write-Host "Setup Complete!" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
