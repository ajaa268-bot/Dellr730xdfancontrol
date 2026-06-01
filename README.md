# Dell PowerEdge iDRAC8 Fan Control Fallback & Auto-Start Utility

A simple, robust solution for managing fan speeds on Dell PowerEdge 13th generation servers (e.g., R730, R730xd, R630, T630) and OEM appliances (like Avigilon HD NVRs) running newer iDRAC8 firmware (version 2.70+ or 2.80+).

## The Problem
Dell PowerEdge servers automatically ramp up system fans to 100% (or very high speeds) if non-Dell (third-party) PCIe expansion cards are installed (e.g., generic SSDs, GPUs, NICs). 

While you can override this behavior and set manual fan speeds using IPMI raw commands (`ipmitool`), newer iDRAC8 firmware features a built-in safety watchdog that automatically resets the fan control mode back to **Automatic** after a short period (typically every 10 to 60 seconds). This causes the fans to constantly rev up and down, which is noisy and frustrating.

## The Solution
This repository contains a lightweight fallback daemon (`dell_fan_control.ps1`) that runs in the background. It continuously:
1. Checks if a primary software controller (like Rem0o's popular [Fan Control](https://github.com/Rem0o/FanControl.Releases) app) is running.
2. If the primary controller is **not running**, it continuously sends WMI-based IPMI commands to lock the fans at a safe fallback speed (e.g., 35%).
3. Since it sends the command every 1 second, it overrides the iDRAC safety watchdog instantly, preventing the fans from revving up.

---

## File Structure
* `dell_fan_control.ps1`: The PowerShell daemon script that loops IPMI control commands.
* `setup.ps1`: An automated script to register the Task Scheduler jobs.

---

## Prerequisites
1. **Enable IPMI over LAN** in your iDRAC settings:
   * Log into the iDRAC Web UI.
   * Go to **iDRAC Settings** > **Network** > **Services**.
   * Enable **IPMI over LAN**.
2. **Dell iDRAC Tools** must be installed on your Windows machine so `ipmitool.exe` is available:
   * Default path checked by script: `C:\Program Files\Dell\SysMgt\iDRACTools\IPMI\ipmitool.exe`

---

## Installation & Setup

1. Open PowerShell as **Administrator**.
2. Clone this repository or copy the files to a directory on your machine (e.g. `C:\Scripts\DellFanControl`).
3. Run the automated setup script:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force
   .\setup.ps1
   ```

The setup script will:
* Register the **DellFanControlFallback** task in Task Scheduler to run the script silently at system startup.
* Ask you if you want to configure an auto-start task for an external fan controller executable (like Rem0o's FanControl) to load automatically when you log in.

---

## Restoring Default (Automatic) iDRAC Control
If you want to remove the scheduled tasks and return your server's fans to default automatic control, run:
```powershell
Stop-ScheduledTask -TaskName "DellFanControlFallback" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "DellFanControlFallback" -Confirm:$false
Unregister-ScheduledTask -TaskName "AutoStartFanController" -Confirm:$false
& "C:\Program Files\Dell\SysMgt\iDRACTools\IPMI\ipmitool.exe" -I wmi raw 0x30 0x30 0x01 0x01
```
