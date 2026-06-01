# install.ps1
# Self-elevating script to install Dell PowerEdge Fan Controller

# 1. Elevate to Administrator if not already admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Elevating privileges to Administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    Exit
}

$InstallDir = "C:\Program Files\PowerEdgeFanCtrl"
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Installing PowerEdge Fan Controller" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Destination: $InstallDir" -ForegroundColor Yellow

# 2. Kill existing running processes if any
Write-Host "Stopping running instances..." -ForegroundColor Gray
taskkill /f /im FanController.exe 2>$null | Out-Null
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq Dell Fan Control*" 2>$null | Out-Null

# 3. Create install folder and copy files
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Write-Host "Copying files..." -ForegroundColor Gray
$filesToCopy = @(
    "FanController.exe",
    "WebView2Loader.dll",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "Microsoft.Web.WebView2.Wpf.dll",
    "server.ps1",
    "register-service.ps1"
)

foreach ($file in $filesToCopy) {
    $src = Join-Path $PSScriptRoot $file
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $InstallDir -Force | Out-Null
    }
}

# Copy public folder recursively
$srcPublic = Join-Path $PSScriptRoot "public"
if (Test-Path $srcPublic) {
    Copy-Item -Path $srcPublic -Destination $InstallDir -Recurse -Force | Out-Null
}

# 4. Copy uninstaller to install folder
$uninstallSrc = Join-Path $PSScriptRoot "uninstall.ps1"
if (Test-Path $uninstallSrc) {
    Copy-Item -Path $uninstallSrc -Destination $InstallDir -Force | Out-Null
}

# 5. Register background startup task (runs server.ps1 as SYSTEM)
Write-Host "Registering background system task..." -ForegroundColor Gray
$registerScript = Join-Path $InstallDir "register-service.ps1"
if (Test-Path $registerScript) {
    # Run the register-service script and force starting now
    & $registerScript
}

# 6. Create Desktop & Start Menu Shortcuts
Write-Host "Creating shortcuts..." -ForegroundColor Gray
try {
    $WshShell = New-Object -ComObject WScript.Shell
    
    # Desktop Shortcut
    $DesktopLnk = "$env:Public\Desktop\PowerEdge Fan Controller.lnk"
    $Shortcut = $WshShell.CreateShortcut($DesktopLnk)
    $Shortcut.TargetPath = Join-Path $InstallDir "FanController.exe"
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "Dell PowerEdge Fan Controller"
    $Shortcut.IconLocation = Join-Path $InstallDir "FanController.exe"
    $Shortcut.Save()
    
    # Start Menu Shortcut
    $StartMenuPath = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\PowerEdge Fan Controller"
    if (-not (Test-Path $StartMenuPath)) {
        New-Item -ItemType Directory -Path $StartMenuPath -Force | Out-Null
    }
    $StartMenuLnk = Join-Path $StartMenuPath "PowerEdge Fan Controller.lnk"
    $Shortcut = $WshShell.CreateShortcut($StartMenuLnk)
    $Shortcut.TargetPath = Join-Path $InstallDir "FanController.exe"
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "Dell PowerEdge Fan Controller"
    $Shortcut.IconLocation = Join-Path $InstallDir "FanController.exe"
    $Shortcut.Save()
    
    Write-Host "Shortcuts successfully created!" -ForegroundColor Green
} catch {
    Write-Warning "Could not create shortcuts: $_"
}

Write-Host "`nInstallation Completed Successfully!" -ForegroundColor Green
Write-Host "You can launch the Controller from your desktop or start menu." -ForegroundColor White
Write-Host "==================================================" -ForegroundColor Cyan
Start-Sleep -Seconds 3
