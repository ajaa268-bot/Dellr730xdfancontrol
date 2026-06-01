# Dell Fan Control Script (Fallback Mode)
# Runs only when the main "FanController" process is NOT running.

$ipmitool = "C:\Program Files\Dell\SysMgt\iDRACTools\IPMI\ipmitool.exe"
$speedHex = "0x32" # 50% fallback fan speed
$appliedFallback = $false

while ($true) {
    # Check if FanController.exe is running
    $fcProcess = Get-Process -Name "FanController" -ErrorAction SilentlyContinue
    
    if (-not $fcProcess) {
        if (-not $appliedFallback) {
            # FanController is NOT running; apply fallback speed to prevent overheating
            try {
                & $ipmitool -I wmi raw 0x30 0x30 0x01 0x00 | Out-Null
                & $ipmitool -I wmi raw 0x30 0x30 0x02 0xff $speedHex | Out-Null
                $appliedFallback = $true
            } catch {
                # Try again on next iteration if busy
            }
        }
    } else {
        # Reset flag when controller is active again
        $appliedFallback = $false
    }
    
    # Sleep 3 seconds before checking again
    Start-Sleep -Seconds 3
}
