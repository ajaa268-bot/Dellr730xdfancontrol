# uninstall.ps1
# Self-elevating script to completely uninstall Dell PowerEdge Fan Controller

# 1. Elevate to Administrator if not already admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Elevating privileges to Administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    Exit
}

$InstallDir = "C:\Program Files\PowerEdgeFanCtrl"
$taskName = "DellFanControlServer"

Write-Host "==================================================" -ForegroundColor Orange
Write-Host " Uninstalling PowerEdge Fan Controller" -ForegroundColor Red
Write-Host "==================================================" -ForegroundColor Orange

# 2. Stop and Unregister background tasks
Write-Host "Removing background system tasks..." -ForegroundColor Gray
try {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false | Out-Null
        Write-Host "Background task '$taskName' removed." -ForegroundColor Green
    } else {
        Write-Host "Background task '$taskName' was not registered." -ForegroundColor Gray
    }
    
    if (Get-ScheduledTask -TaskName "DellFanControlFallback" -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName "DellFanControlFallback" -Confirm:$false | Out-Null
        Write-Host "Background fallback task 'DellFanControlFallback' removed." -ForegroundColor Green
    } else {
        Write-Host "Background fallback task 'DellFanControlFallback' was not registered." -ForegroundColor Gray
    }
} catch {
    Write-Warning "Could not unregister scheduled tasks: $_"
}

# 3. Kill active processes
Write-Host "Stopping running instances..." -ForegroundColor Gray
taskkill /f /im FanController.exe 2>$null | Out-Null
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq Dell Fan Control*" 2>$null | Out-Null

# 4. Remove Shortcuts
Write-Host "Removing shortcuts..." -ForegroundColor Gray
$desktopLnk = "$env:Public\Desktop\PowerEdge Fan Controller.lnk"
if (Test-Path $desktopLnk) {
    Remove-Item -Path $desktopLnk -Force -ErrorAction SilentlyContinue
}

$startMenuPath = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\PowerEdge Fan Controller"
if (Test-Path $startMenuPath) {
    Remove-Item -Path $startMenuPath -Recurse -Force -ErrorAction SilentlyContinue
}

# 5. Clean up files and self-delete the folder
Write-Host "Cleaning up folder files..." -ForegroundColor Gray
# We schedule a background CMD execution that waits 1 second (allowing this powershell process to exit) and then deletes the folder recursively.
Write-Host "Completing cleanup..." -ForegroundColor Green
Start-Process cmd.exe -ArgumentList "/c timeout /t 1 && rmdir /s /q `"$InstallDir`"" -WindowStyle Hidden

Write-Host "Uninstallation Completed Cleanly!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Orange
Start-Sleep -Seconds 2
