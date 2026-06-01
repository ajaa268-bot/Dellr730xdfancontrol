# Dell Fan Control PowerShell Web Server
# Serves the Fan Control Dashboard UI and controls fan speed locally via WMI

$ipmitool = "C:\Program Files\Dell\SysMgt\iDRACTools\IPMI\ipmitool.exe"
if (-not (Test-Path $ipmitool)) {
    $foundIpmi = Get-Command "ipmitool.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if ($foundIpmi) { $ipmitool = $foundIpmi }
}
if (-not (Test-Path $ipmitool) -and -not (Get-Command $ipmitool -ErrorAction SilentlyContinue)) {
    $ipmitool = Join-Path $PSScriptRoot "ipmitool.exe"
}

# Global State
$global:mode = "auto"   # "auto", "manual", "curve"
$global:speed = 20      # percentage (10 to 100)
$global:cpuTemp = "--"
$global:gpuTemp = "--"
$global:deg = [char]176
$global:safetyThreshold = 85
$global:safetyOverride = $false
$global:pin = ""        # Simple security PIN (leave empty to disable)
$global:lastKnownCpuVal = 35  # reasonable default
$global:lastKnownGpuVal = 35  # reasonable default
$global:applyPending = $true  # Force initial application of settings on startup
$global:history = [System.Collections.Generic.List[PSCustomObject]]::new()
$global:curvePoints = @(
    [PSCustomObject]@{ temp = 40; speed = 15 }
    [PSCustomObject]@{ temp = 55; speed = 25 }
    [PSCustomObject]@{ temp = 70; speed = 50 }
    [PSCustomObject]@{ temp = 80; speed = 75 }
    [PSCustomObject]@{ temp = 85; speed = 100 }
)

# Configuration File Persistence
$global:configFile = Join-Path $PSScriptRoot "config.json"

function Save-Config {
    $config = [PSCustomObject]@{
        mode            = $global:mode
        speed           = $global:speed
        safetyThreshold = $global:safetyThreshold
        curvePoints     = $global:curvePoints
    }
    try {
        $config | ConvertTo-Json -Depth 10 | Out-File $global:configFile -Encoding UTF8
    } catch {
        Write-Warning "Failed to save config: $_"
    }
}

function Load-Config {
    if (Test-Path $global:configFile) {
        try {
            $config = Get-Content $global:configFile -Raw | ConvertFrom-Json
            if ($null -ne $config.mode) { $global:mode = $config.mode }
            if ($null -ne $config.speed) { $global:speed = [int]$config.speed }
            if ($null -ne $config.safetyThreshold) { $global:safetyThreshold = [int]$config.safetyThreshold }
            if ($null -ne $config.curvePoints) {
                $points = @()
                foreach ($p in $config.curvePoints) {
                    $points += [PSCustomObject]@{ temp = [double]$p.temp; speed = [double]$p.speed }
                }
                $global:curvePoints = $points
            }
            Write-Host "Config loaded successfully from $global:configFile" -ForegroundColor Green
        } catch {
            Write-Warning "Failed to load config: $_"
        }
    }
}

# Load saved configurations
Load-Config

# Helper: Append entry to history
function Add-HistoryEntry {
    param($cpu, $gpu, $speed, $mode, $safety)
    $entry = [PSCustomObject]@{
        timestamp = (Get-Date -Format "HH:mm:ss")
        cpuTemp   = $cpu
        gpuTemp   = $gpu
        speed     = $speed
        mode      = $mode
        safety    = $safety
    }
    $global:history.Add($entry)
    while ($global:history.Count -gt 60) {
        $global:history.RemoveAt(0)
    }
}

# Helper: Interpolate speed from curve
function Get-CurveSpeed {
    param([double]$temp)
    $sortedPoints = $global:curvePoints | Sort-Object temp
    if ($sortedPoints.Count -eq 0) { return 20 }
    
    # Below lowest point
    if ($temp -le $sortedPoints[0].temp) { return $sortedPoints[0].speed }
    # Above highest point
    if ($temp -ge $sortedPoints[-1].temp) { return $sortedPoints[-1].speed }
    
    # Interpolate
    for ($i = 0; $i -lt ($sortedPoints.Count - 1); $i++) {
        $p1 = $sortedPoints[$i]
        $p2 = $sortedPoints[$i+1]
        if ($temp -ge $p1.temp -and $temp -le $p2.temp) {
            $ratio = ($temp - $p1.temp) / ($p2.temp - $p1.temp)
            $computedSpeed = $p1.speed + $ratio * ($p2.speed - $p1.speed)
            return [Math]::Max(10, [Math]::Min(100, [Math]::Round($computedSpeed)))
        }
    }
    return 20
}

$port = 3000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host " Dell Fan Control Dashboard Server (PowerShell)" -ForegroundColor Green
    Write-Host " Running on: http://localhost:$port/" -ForegroundColor Green
    Write-Host " ipmitool: $ipmitool" -ForegroundColor Yellow
    Write-Host " Keep this window open. Press Ctrl+C to stop." -ForegroundColor White
    Write-Host "==================================================" -ForegroundColor Cyan
} catch {
    Write-Error "Failed to start listener: $_"
    Exit
}

$lastRun = [DateTime]::MinValue
$lastTempCheck = [DateTime]::MinValue
$lastHistoryLog = [DateTime]::MinValue

# Initialize the first asynchronous request wait handle
$contextAsync = $listener.BeginGetContext($null, $null)

while ($listener.IsListening) {
    # Get current time
    $now = Get-Date

    # 1a. Async Apply settings immediately on change (so HTTP requests don't block)
    if ($global:applyPending -and -not $global:safetyOverride) {
        $global:applyPending = $false
        try {
            if ($global:mode -eq "manual") {
                $speedHex = "0x" + $global:speed.ToString("X2")
                Write-Host "[Async Apply] Enforcing manual mode, speed: $global:speed% ($speedHex)..." -ForegroundColor Green
                & $ipmitool -I wmi raw 0x30 0x30 0x01 0x00 | Out-Null
                & $ipmitool -I wmi raw 0x30 0x30 0x02 0xff $speedHex | Out-Null
                $lastRun = $now
            } elseif ($global:mode -eq "curve") {
                # Force instant recheck of temperature & curve mapping
                $lastTempCheck = [DateTime]::MinValue
            } else {
                Write-Host "[Async Apply] Enforcing auto mode..." -ForegroundColor Green
                & $ipmitool -I wmi raw 0x30 0x30 0x01 0x01 | Out-Null
                $lastRun = $now
            }
        } catch {
            Write-Warning "Async settings application failed: $_"
        }
    }

    # 1. Daemon Loop: Apply fan speed periodically (every 5 seconds) to prevent iDRAC override
    # Applies to BOTH manual and curve modes
    if (($global:mode -eq "manual" -or $global:mode -eq "curve") -and -not $global:safetyOverride -and ($now - $lastRun).TotalSeconds -ge 3) {
        $speedHex = "0x" + $global:speed.ToString("X2")
        try {
            Write-Host "[Daemon] Enforcing mode: $global:mode, speed: $global:speed% ($speedHex)..." -ForegroundColor Yellow
            & $ipmitool -I wmi raw 0x30 0x30 0x01 0x00 | Out-Null
            & $ipmitool -I wmi raw 0x30 0x30 0x02 0xff $speedHex | Out-Null
            $lastRun = $now
        } catch {
            Write-Warning "Failed to set fan speed: $_"
        }
    }

    # 1b. Temp Monitor & Rule Execution Loop (every 3 seconds)
    if (($now - $lastTempCheck).TotalSeconds -ge 3) {
        # Fetch CPU temperature via ipmitool WMI
        try {
            $ipmiOutput = & $ipmitool -I wmi sdr type Temperature 2>$null
            $cpuTemps = @()
            foreach ($line in ($ipmiOutput -split "`r?`n")) {
                if ($line -match "Temp\s+\|\s+\w+h\s+\|\s+ok\s+\|\s+[\d\.]+\s+\|\s+(\d+)\s+degrees C" -and $line -notmatch "Inlet" -and $line -notmatch "Exhaust") {
                    $cpuTemps += "$($Matches[1])$global:deg`C"
                }
            }
            # Retry up to 3 times if no temperatures were read (often due to temporary Node busy errors)
            $retryCount = 0
            while ($cpuTemps.Count -eq 0 -and $retryCount -lt 3) {
                Start-Sleep -Milliseconds 1000
                $ipmiOutput = & $ipmitool -I wmi sdr type Temperature 2>$null
                foreach ($line in ($ipmiOutput -split "`r?`n")) {
                    if ($line -match "Temp\s+\|\s+\w+h\s+\|\s+ok\s+\|\s+[\d\.]+\s+\|\s+(\d+)\s+degrees C" -and $line -notmatch "Inlet" -and $line -notmatch "Exhaust") {
                        $cpuTemps += "$($Matches[1])$global:deg`C"
                    }
                }
                $retryCount++
            }
            if ($cpuTemps.Count -gt 0) {
                $global:cpuTemp = $cpuTemps -join " / "
            }
        } catch {
            # Keep last known temperature to prevent flickering
        }

        # Fetch GPU temperature via nvidia-smi
        try {
            $gpuOut = & nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>$null
            if ($null -ne $gpuOut) {
                $global:gpuTemp = "$($gpuOut.Trim())$global:deg`C"
            } else {
                $global:gpuTemp = "N/A"
            }
        } catch {
            $global:gpuTemp = "N/A"
        }

        # Parse temperatures for safety override and custom fan curve
        $cpuVal = $null
        $gpuVal = $null
        $cpuMatches = [regex]::Matches($global:cpuTemp, "(\d+)")
        if ($cpuMatches.Count -gt 0) {
            $cpuVal = ($cpuMatches | ForEach-Object { [double]$_.Groups[1].Value } | Measure-Object -Maximum).Maximum
            $global:lastKnownCpuVal = $cpuVal
        } else {
            $cpuVal = $global:lastKnownCpuVal
        }
        if ($global:gpuTemp -match "(\d+)") {
            $gpuVal = [double]$Matches[1]
            $global:lastKnownGpuVal = $gpuVal
        } else {
            $gpuVal = $global:lastKnownGpuVal
        }

        $highestTemp = 0
        if ($null -ne $cpuVal -and $cpuVal -gt $highestTemp) { $highestTemp = $cpuVal }
        if ($null -ne $gpuVal -and $gpuVal -gt $highestTemp) { $highestTemp = $gpuVal }

        # Safety Override Logic
        if ($highestTemp -gt 0) {
            if ($highestTemp -ge $global:safetyThreshold) {
                if (-not $global:safetyOverride) {
                    $global:safetyOverride = $true
                    # Revert to iDRAC auto mode for safety
                    try {
                        Write-Host "[Safety] WARNING: Temperature ($highestTemp°C) exceeded safety threshold ($global:safetyThreshold°C). Triggering Safety Override!" -ForegroundColor Red
                        & $ipmitool -I wmi raw 0x30 0x30 0x01 0x01 | Out-Null
                    } catch {
                        Write-Error "Safety override command failed: $_"
                    }
                }
            } elseif ($global:safetyOverride -and $highestTemp -lt ($global:safetyThreshold - 10)) {
                $global:safetyOverride = $false
                Write-Host "[Safety] Info: Temperature ($highestTemp°C) has cooled down. Clearing safety override." -ForegroundColor Green
                # Re-apply mode changes
                if ($global:mode -eq "auto") {
                    try { & $ipmitool -I wmi raw 0x30 0x30 0x01 0x01 | Out-Null } catch {}
                }
            }
        }

        # Custom Curve Logic
        if ($global:mode -eq "curve" -and -not $global:safetyOverride -and $highestTemp -gt 0) {
            $targetSpeed = Get-CurveSpeed -temp $highestTemp
            if ($targetSpeed -ne $global:speed) {
                # Smooth ramp up/down: limit change to at most 3% per 5-second interval
                $maxStep = 3
                $difference = $targetSpeed - $global:speed
                if ($difference -gt $maxStep) {
                    $global:speed += $maxStep
                } elseif ($difference -lt -$maxStep) {
                    $global:speed -= $maxStep
                } else {
                    $global:speed = $targetSpeed
                }

                $speedHex = "0x" + $global:speed.ToString("X2")
                try {
                    Write-Host "[Curve] Temp ($highestTemp°C) target: $targetSpeed%. Gradual speed: $global:speed% ($speedHex)..." -ForegroundColor Cyan
                    & $ipmitool -I wmi raw 0x30 0x30 0x01 0x00 | Out-Null
                    & $ipmitool -I wmi raw 0x30 0x30 0x02 0xff $speedHex | Out-Null
                    $lastRun = $now
                } catch {
                    Write-Warning "Curve application failed: $_"
                }
            }
        }

        # Append to History (limit rate to every 10 seconds to keep history clean)
        if (($now - $lastHistoryLog).TotalSeconds -ge 10) {
            # Normalize display speed (if auto and not manual/curve, speed is dynamic, reported as iDRAC)
            $histSpeed = if ($global:mode -eq "auto") { $null } else { $global:speed }
            Add-HistoryEntry -cpu $cpuVal -gpu $gpuVal -speed $histSpeed -mode $global:mode -safety $global:safetyOverride
            $lastHistoryLog = $now
        }

        $lastTempCheck = $now
    }

    # 2. Web Server: Non-blocking check for incoming request using the persistent async handle
    if (-not $contextAsync.AsyncWaitHandle.WaitOne(20)) {
        continue # Timeout, loop again to check daemon
    }

    # Retrieve request context
    try {
        $context = $listener.EndGetContext($contextAsync)
    } catch {
        # Re-initialize handle if failed
        $contextAsync = $listener.BeginGetContext($null, $null)
        continue
    }

    # Instantly wait for next request
    $contextAsync = $listener.BeginGetContext($null, $null)

    $request = $context.Request
    $response = $context.Response
    $rawPath = $request.Url.LocalPath
    Write-Host "$($request.HttpMethod) $rawPath" -ForegroundColor Gray

    # Helper: Send JSON Response
    function Send-JSON {
        param($obj, $statusCode = 200)
        $json = ConvertTo-Json $obj -Depth 10
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
        $response.StatusCode = $statusCode
        $response.ContentType = "application/json; charset=utf-8"
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
    }

    # PIN validation helper
    function Assert-Authorized {
        if ($global:pin -eq "") { return $true }
        
        # Check header first: 'Authorization: Bearer <pin>' or 'X-PIN: <pin>'
        $authHeader = $request.Headers["Authorization"]
        $xPinHeader = $request.Headers["X-PIN"]
        $providedPin = ""
        
        if ($authHeader -and $authHeader -like "Bearer *") {
            $providedPin = $authHeader.Substring(7).Trim()
        } elseif ($xPinHeader) {
            $providedPin = $xPinHeader.Trim()
        }
        
        if ($providedPin -eq $global:pin) { return $true }
        return $false
    }

    # Router
    if ($rawPath -eq "/api/status" -and $request.HttpMethod -eq "GET") {
        $statusObj = [PSCustomObject]@{
            success         = $true
            mode            = $global:mode
            speed           = $global:speed
            cpuTemp         = $global:cpuTemp
            gpuTemp         = $global:gpuTemp
            safetyThreshold = $global:safetyThreshold
            safetyOverride  = $global:safetyOverride
            pinRequired     = ($global:pin -ne "")
            curvePoints     = $global:curvePoints
            history         = $global:history
        }
        Send-JSON -obj $statusObj
    }
    elseif ($rawPath -eq "/api/control" -and $request.HttpMethod -eq "POST") {
        try {
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $jsonBody = $reader.ReadToEnd()
            $data = ConvertFrom-Json $jsonBody

            # Validate PIN if active
            $authorized = Assert-Authorized
            if (-not $authorized -and ($null -ne $data.pin -and $data.pin.ToString() -eq $global:pin)) {
                $authorized = $true
            }

            if (-not $authorized) {
                $resObj = [PSCustomObject]@{
                    success = $false
                    error   = "Unauthorized: Invalid or missing security PIN"
                }
                Send-JSON -obj $resObj -statusCode 401
                continue
            }

            # Update configurations
            if ($null -ne $data.safetyThreshold) {
                $global:safetyThreshold = [int]$data.safetyThreshold
            }
            if ($null -ne $data.curvePoints) {
                $points = @()
                foreach ($p in $data.curvePoints) {
                    $points += [PSCustomObject]@{ temp = [double]$p.temp; speed = [double]$p.speed }
                }
                $global:curvePoints = $points
            }
            if ($null -ne $data.newPin) {
                $global:pin = $data.newPin.ToString()
                Write-Host "[API] Security PIN has been updated." -ForegroundColor Green
            }

            if ($null -ne $data.mode) {
                $global:mode = $data.mode
            }
            if ($null -ne $data.speed) {
                $global:speed = [int]$data.speed
            }

            Write-Host "[API] Settings updated: Mode=$global:mode, Speed=$global:speed%, Safety=$global:safetyThreshold°C" -ForegroundColor Green

            # Save settings persistently
            Save-Config

            # Flag to apply settings asynchronously in the background loop
            $global:applyPending = $true

            $resObj = [PSCustomObject]@{
                success = $true
                mode    = $global:mode
                speed   = $global:speed
                message = "Successfully updated fan control settings"
            }
            Send-JSON -obj $resObj
        } catch {
            $resObj = [PSCustomObject]@{
                success = $false
                error   = $_.Exception.Message
            }
            Send-JSON -obj $resObj -statusCode 500
        }
    }
    else {
        # Serve Static Files
        $filePath = $rawPath
        if ($filePath -eq "/") { $filePath = "/index.html" }
        
        $localFile = Join-Path (Join-Path $PSScriptRoot "public") $filePath

        if (Test-Path $localFile -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localFile)
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                default { $response.ContentType = "application/octet-stream" }
            }

            # Disable caching
            $response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            $response.Headers.Add("Pragma", "no-cache")

            $buffer = [System.IO.File]::ReadAllBytes($localFile)
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $response.Close()
    }
}
