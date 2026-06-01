# Dell Fan Control Script (Fallback Mode)
# Runs only when the main "FanController" process is NOT running.

$ipmitool = "C:\Program Files\Dell\SysMgt\iDRACTools\IPMI\ipmitool.exe"
$speedHex = "0x23" # 35% fallback fan speed

while ($true) {
    # Check if FanController.exe is running
    $fcProcess = Get-Process -Name "FanController" -ErrorAction SilentlyContinue
    
    if (-not $fcProcess) {
        # FanController is NOT running; apply fallback speed to prevent overheating
        try {
            & $ipmitool -I wmi raw 0x30 0x30 0x01 0x00 | Out-Null
            & $ipmitool -I wmi raw 0x30 0x30 0x02 0xff $speedHex | Out-Null
        } catch {
            # Suppress errors if WMI is busy
        }
    }
    
    # Sleep 2 seconds before checking again
    Start-Sleep -Seconds 2
}
