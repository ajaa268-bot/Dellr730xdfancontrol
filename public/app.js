const API_URL = '/api';

// DOM Elements
const badge = document.getElementById('connection-badge');
const btnAuto = document.getElementById('btn-mode-auto');
const btnCurve = document.getElementById('btn-mode-curve');
const btnManual = document.getElementById('btn-mode-manual');
const manualControls = document.getElementById('manual-controls');
const speedSlider = document.getElementById('fan-speed-slider');
const speedFill = document.getElementById('slider-fill');
const speedDisplay = document.getElementById('speed-value-display');
const presetBtns = document.querySelectorAll('.preset-btn');
const btnApply = document.getElementById('btn-apply');
const visualFan = document.getElementById('visual-fan');
const fanGlow = document.getElementById('fan-glow');

const statMode = document.getElementById('stat-mode');
const statSpeed = document.getElementById('stat-speed');
const statCpuTemp = document.getElementById('stat-cpu-temp');
const statGpuTemp = document.getElementById('stat-gpu-temp');
const statSafety = document.getElementById('stat-safety');

// New DOM Elements
const curvePointsList = document.getElementById('curve-points-list');
const btnApplyCurve = document.getElementById('btn-apply-curve');
const safetySlider = document.getElementById('safety-temp-slider');
const safetySliderFill = document.getElementById('safety-slider-fill');
const safetyDisplay = document.getElementById('safety-temp-display');
const pinField = document.getElementById('pin-field');
const btnSavePin = document.getElementById('btn-save-pin');

let appState = {
    mode: 'auto',
    speed: 20,
    isConnected: false,
    safetyThreshold: 85,
    safetyOverride: false,
    curvePoints: [],
    pinRequired: false
};

// Chart.js Instance
let historyChart = null;
let lastManualChangeTime = 0;

// Initialize PIN from localStorage
if (localStorage.getItem('dashboard_pin')) {
    pinField.value = localStorage.getItem('dashboard_pin');
    btnSavePin.textContent = 'Clear PIN';
    btnSavePin.classList.add('active');
}

// Update Slider Track UI representation
function updateSliderUI(value) {
    speedSlider.value = value;
    speedDisplay.textContent = `${value}%`;
    const percent = ((value - speedSlider.min) / (speedSlider.max - speedSlider.min)) * 100;
    speedFill.style.width = `${percent}%`;
}

function updateSafetySliderUI(value) {
    safetySlider.value = value;
    safetyDisplay.textContent = `${value}°C`;
    const percent = ((value - safetySlider.min) / (safetySlider.max - safetySlider.min)) * 100;
    safetySliderFill.style.width = `${percent}%`;
}

// Sync DOM with state
function updateUI() {
    // Connection badge
    if (appState.isConnected) {
        badge.textContent = 'Connected';
        badge.className = 'badge badge-connected';
        
        // Hide cover loading screen
        const loader = document.getElementById('app-loading-screen');
        if (loader) {
            loader.classList.add('fade-out');
            setTimeout(() => {
                loader.style.display = 'none';
            }, 500);
        }
    } else {
        badge.textContent = 'Offline';
        badge.className = 'badge badge-disconnected';
        return; // Don't update other controls if disconnected
    }

    // Active mode buttons
    btnAuto.classList.remove('active');
    btnCurve.classList.remove('active');
    btnManual.classList.remove('active');
    
    // Safety status indicator
    if (appState.safetyOverride) {
        statSafety.textContent = 'EMERGENCY OVERRIDE (HIGH TEMP)';
        statSafety.className = 'stat-val text-glow-orange';
        document.documentElement.style.setProperty('--neon-blue', '#ff3300');
        document.documentElement.style.setProperty('--neon-blue-glow', 'rgba(255, 51, 0, 0.4)');
    } else {
        statSafety.textContent = 'Safe';
        statSafety.className = 'stat-val text-glow-green';
    }

    const activeTheme = themes[currentTheme] || themes.cyberpunk;
    let modeColors;
    if (appState.safetyOverride) {
        modeColors = activeTheme.safety;
    } else if (appState.mode === 'auto') {
        modeColors = activeTheme.auto;
    } else if (appState.mode === 'curve') {
        modeColors = activeTheme.curve;
    } else {
        modeColors = activeTheme.manual;
    }
    
    document.documentElement.style.setProperty('--neon-blue', modeColors.color);
    document.documentElement.style.setProperty('--neon-blue-glow', modeColors.glow);

    if (appState.mode === 'auto' || appState.safetyOverride) {
        btnAuto.classList.add('active');
        manualControls.classList.add('disabled');
        speedSlider.disabled = true;
        btnApply.disabled = true;
        
        statMode.textContent = appState.safetyOverride ? 'Auto (Override)' : 'Automatic';
        statMode.className = 'stat-val text-glow-green';
        statSpeed.textContent = 'Dynamic (iDRAC)';
        statSpeed.style.color = 'var(--text-primary)';
    } else if (appState.mode === 'curve') {
        btnCurve.classList.add('active');
        manualControls.classList.add('disabled');
        speedSlider.disabled = true;
        btnApply.disabled = true;

        statMode.textContent = 'Smart Curve';
        statMode.className = 'stat-val text-glow-orange';
        statSpeed.textContent = `Curve: ${appState.speed}%`;
        statSpeed.style.color = 'var(--neon-blue)';
    } else {
        btnManual.classList.add('active');
        manualControls.classList.remove('disabled');
        speedSlider.disabled = false;
        btnApply.disabled = false;
        
        statMode.textContent = 'Manual';
        statMode.className = 'stat-val text-glow-orange';
        statSpeed.textContent = `${appState.speed}%`;
        statSpeed.style.color = 'var(--neon-blue)';
    }

    // Set fan rotation speed dynamically using CSS variable
    let speedVal = appState.speed;
    if (appState.mode === 'auto') speedVal = 35; // Default spin speed visual for auto
    if (appState.safetyOverride) speedVal = 100;
    
    // Rotate faster as speed increases
    const duration = Math.max(0.15, 3 - (speedVal / 35));
    visualFan.style.animation = `spin ${duration}s linear infinite`;

    // Activate selected preset btn
    presetBtns.forEach(btn => {
        const presetVal = parseInt(btn.dataset.speed, 10);
        if (appState.mode === 'manual' && presetVal === appState.speed) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Populate curve points editor if empty
    if (curvePointsList.children.length === 0 && appState.curvePoints.length > 0) {
        renderCurvePoints();
    }

    // Sync dock mini buttons
    const dockBtnAuto = document.getElementById('dock-btn-auto');
    const dockBtnCurve = document.getElementById('dock-btn-curve');
    const dockBtnManual = document.getElementById('dock-btn-manual');
    const dockManualSpeed = document.getElementById('dock-manual-speed');
    const dockSpeedDisplay = document.getElementById('dock-speed-display');

    if (dockBtnAuto) dockBtnAuto.classList.toggle('active', appState.mode === 'auto' || appState.safetyOverride);
    if (dockBtnCurve) dockBtnCurve.classList.toggle('active', appState.mode === 'curve');
    if (dockBtnManual) dockBtnManual.classList.toggle('active', appState.mode === 'manual' && !appState.safetyOverride);
    
    if (dockManualSpeed) {
        if (appState.mode === 'manual' && !appState.safetyOverride) {
            dockManualSpeed.classList.remove('disabled');
        } else {
            dockManualSpeed.classList.add('disabled');
        }
    }
    if (dockSpeedDisplay) {
        dockSpeedDisplay.textContent = `${appState.speed}%`;
    }
}

// Generate the Curve Editor List elements
function renderCurvePoints() {
    curvePointsList.innerHTML = '';
    appState.curvePoints.forEach((pt, index) => {
        const row = document.createElement('div');
        row.className = 'curve-point-row';
        row.innerHTML = `
            <span class="point-num">#${index + 1}</span>
            <div class="input-wrap">
                <input type="number" class="curve-temp-input" data-index="${index}" value="${pt.temp}" min="0" max="100">
                <span class="input-unit">°C</span>
            </div>
            <span class="point-arrow">➔</span>
            <div class="input-wrap">
                <input type="number" class="curve-speed-input" data-index="${index}" value="${pt.speed}" min="10" max="100">
                <span class="input-unit">%</span>
            </div>
        `;
        curvePointsList.appendChild(row);
    });
}

// Update or initialize the Chart.js performance history graph
function updateChart(history) {
    if (!history || history.length === 0) return;

    const labels = history.map(h => h.timestamp);
    const cpuData = history.map(h => {
        if (!h.cpuTemp) return null;
        // If CPU temp string is composite, parse the highest value
        if (typeof h.cpuTemp === 'string') {
            const matches = h.cpuTemp.match(/\d+/g);
            return matches ? Math.max(...matches.map(Number)) : null;
        }
        return h.cpuTemp;
    });
    const gpuData = history.map(h => {
        if (!h.gpuTemp) return null;
        if (typeof h.gpuTemp === 'string') {
            const matches = h.gpuTemp.match(/\d+/);
            return matches ? Number(matches[0]) : null;
        }
        return h.gpuTemp;
    });
    const speedData = history.map(h => h.speed);

    if (historyChart) {
        historyChart.data.labels = labels;
        historyChart.data.datasets[0].data = cpuData;
        historyChart.data.datasets[1].data = gpuData;
        historyChart.data.datasets[2].data = speedData;
        historyChart.update('none'); // Update without full animation for performance
    } else {
        const activeTheme = themes[currentTheme] || themes.cyberpunk;
        const ctx = document.getElementById('history-chart').getContext('2d');
        historyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'CPU Temp (°C)',
                        data: cpuData,
                        borderColor: activeTheme.auto.color,
                        backgroundColor: activeTheme.auto.glow.replace('0.4', '0.1'),
                        borderWidth: 2,
                        tension: 0.3,
                        yAxisID: 'yTemp'
                    },
                    {
                        label: 'GPU Temp (°C)',
                        data: gpuData,
                        borderColor: activeTheme.curve.color,
                        backgroundColor: activeTheme.curve.glow.replace('0.4', '0.1'),
                        borderWidth: 2,
                        tension: 0.3,
                        yAxisID: 'yTemp'
                    },
                    {
                        label: 'Fan Speed (%)',
                        data: speedData,
                        borderColor: activeTheme.manual.color,
                        backgroundColor: activeTheme.manual.glow.replace('0.4', '0.05'),
                        borderWidth: 1.5,
                        fill: true,
                        tension: 0.2,
                        yAxisID: 'ySpeed'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#ffffff',
                            font: { family: 'Outfit' }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { family: 'JetBrains Mono' } }
                    },
                    yTemp: {
                        type: 'linear',
                        position: 'left',
                        min: 20,
                        max: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#ff3366', font: { family: 'Outfit' } },
                        title: { display: true, text: 'Temperature (°C)', color: '#ffffff' }
                    },
                    ySpeed: {
                        type: 'linear',
                        position: 'right',
                        min: 0,
                        max: 100,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#00e5ff', font: { family: 'Outfit' } },
                        title: { display: true, text: 'Fan Speed (%)', color: '#00e5ff' }
                    }
                }
            }
        });
    }
}

// Fetch status from server
async function fetchStatus() {
    try {
        const headers = {};
        const localPin = localStorage.getItem('dashboard_pin');
        if (localPin) {
            headers['X-PIN'] = localPin;
        }

        const response = await fetch(`${API_URL}/status`, { headers });
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();
        
        appState.isConnected = true;
        appState.mode = data.mode;
        appState.speed = data.speed;
        appState.safetyThreshold = data.safetyThreshold;
        appState.safetyOverride = data.safetyOverride;
        appState.curvePoints = data.curvePoints || [];
        appState.pinRequired = data.pinRequired;
        
        // Update slider position if not active manual input and not changed recently
        const timeSinceManualChange = Date.now() - lastManualChangeTime;
        if (document.activeElement !== speedSlider && appState.mode === 'manual' && timeSinceManualChange > 4000) {
            updateSliderUI(appState.speed);
        }

        if (document.activeElement !== safetySlider && timeSinceManualChange > 4000) {
            updateSafetySliderUI(appState.safetyThreshold);
        }
        
        // Update temperatures
        statCpuTemp.textContent = data.cpuTemp || '--';
        statGpuTemp.textContent = data.gpuTemp || '--';
        
        updateUI();
        updateChart(data.history);
    } catch (err) {
        appState.isConnected = false;
        updateUI();
    }
}

// Send control/config updates to server
async function sendControl(params) {
    try {
        if (params.speed !== undefined || params.mode !== undefined || params.safetyThreshold !== undefined || params.curvePoints !== undefined) {
            lastManualChangeTime = Date.now();
        }

        const localPin = localStorage.getItem('dashboard_pin') || '';
        const body = { ...params, pin: localPin };

        const response = await fetch(`${API_URL}/control`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-PIN': localPin
            },
            body: JSON.stringify(body)
        });

        if (response.status === 401) {
            alert('Security Error: Invalid or missing PIN. Please enter correct PIN in protection block.');
            return;
        }

        if (!response.ok) throw new Error('API Error');
        const data = await response.json();
        
        if (params.mode) appState.mode = data.mode;
        if (params.speed) appState.speed = data.speed;
        
        // Sync sliders immediately with returned confirmed server state
        if (appState.mode === 'manual') {
            updateSliderUI(appState.speed);
        }
        if (data.safetyThreshold) {
            appState.safetyThreshold = data.safetyThreshold;
            updateSafetySliderUI(appState.safetyThreshold);
        }
        
        fetchStatus();
    } catch (err) {
        console.error('Failed to apply settings:', err);
        alert('Error: Could not apply settings to server.');
    }
}

// Event Listeners
btnAuto.addEventListener('click', () => {
    if (appState.mode !== 'auto') {
        appState.mode = 'auto';
        updateUI();
        sendControl({ mode: 'auto' });
    }
});

btnCurve.addEventListener('click', () => {
    if (appState.mode !== 'curve') {
        appState.mode = 'curve';
        updateUI();
        sendControl({ mode: 'curve' });
    }
});

btnManual.addEventListener('click', () => {
    if (appState.mode !== 'manual') {
        appState.mode = 'manual';
        updateUI();
        sendControl({ mode: 'manual', speed: parseInt(speedSlider.value, 10) });
    }
});

speedSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    updateSliderUI(val);
});

btnApply.addEventListener('click', () => {
    const val = parseInt(speedSlider.value, 10);
    sendControl({ mode: 'manual', speed: val });
});

presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.speed, 10);
        updateSliderUI(val);
        sendControl({ mode: 'manual', speed: val });
    });
});

// Curve application
btnApplyCurve.addEventListener('click', () => {
    const tempInputs = document.querySelectorAll('.curve-temp-input');
    const speedInputs = document.querySelectorAll('.curve-speed-input');
    const newPoints = [];

    for (let i = 0; i < tempInputs.length; i++) {
        newPoints.push({
            temp: parseFloat(tempInputs[i].value),
            speed: parseFloat(speedInputs[i].value)
        });
    }

    sendControl({ curvePoints: newPoints });
});

// Safety Threshold Change
safetySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    updateSafetySliderUI(val);
});

safetySlider.addEventListener('change', () => {
    const val = parseInt(safetySlider.value, 10);
    sendControl({ safetyThreshold: val });
});

// Save PIN locally
btnSavePin.addEventListener('click', () => {
    if (btnSavePin.classList.contains('active')) {
        localStorage.removeItem('dashboard_pin');
        pinField.value = '';
        btnSavePin.textContent = 'Set Local PIN';
        btnSavePin.classList.remove('active');
        fetchStatus();
    } else {
        const pin = pinField.value.trim();
        if (pin) {
            localStorage.setItem('dashboard_pin', pin);
            btnSavePin.textContent = 'Clear PIN';
            btnSavePin.classList.add('active');
            fetchStatus();
        } else {
            alert('Please enter a PIN first.');
        }
    }
});

// UI Scaling Logic
const appScaleSelect = document.getElementById('app-scale-select');
const dockScaleSelect = document.getElementById('dock-scale-select');

let currentScale = parseFloat(localStorage.getItem('app_scale') || '1.0');

function applyScale(scale) {
    currentScale = scale;
    localStorage.setItem('app_scale', scale);
    document.documentElement.style.setProperty('--app-scale', scale);
    
    // Sync dropdowns
    if (appScaleSelect) appScaleSelect.value = scale;
    if (dockScaleSelect) dockScaleSelect.value = scale;
    
    // Send resize request to native host if webview is available
    if (window.chrome && window.chrome.webview) {
        const container = document.querySelector('.app-container');
        const isDock = container.classList.contains('dock-layout');
        if (isDock) {
            window.chrome.webview.postMessage("dock:" + Math.round(48 * scale) + ":" + scale);
        } else {
            window.chrome.webview.postMessage("standard:" + Math.round(720 * scale) + ":" + scale);
        }
    }
}

if (appScaleSelect) {
    appScaleSelect.addEventListener('change', (e) => {
        applyScale(parseFloat(e.target.value));
    });
}
if (dockScaleSelect) {
    dockScaleSelect.addEventListener('change', (e) => {
        applyScale(parseFloat(e.target.value));
    });
}

// Dock Mode Toggle
const btnToggleDock = document.getElementById('btn-toggle-dock');
btnToggleDock.addEventListener('click', () => {
    const container = document.querySelector('.app-container');
    container.classList.toggle('dock-layout');
    const isDock = container.classList.contains('dock-layout');
    if (isDock) {
        btnToggleDock.innerHTML = '🖥️ Standard View';
    } else {
        btnToggleDock.innerHTML = '📺 Dock View';
    }
    
    // Notify native C# app to resize window based on scale
    if (window.chrome && window.chrome.webview) {
        if (isDock) {
            window.chrome.webview.postMessage("dock:" + Math.round(48 * currentScale) + ":" + currentScale);
        } else {
            window.chrome.webview.postMessage("standard:" + Math.round(720 * currentScale) + ":" + currentScale);
        }
    }

    // Resize chart if present
    if (historyChart) {
        setTimeout(() => historyChart.resize(), 100);
    }
});

// Double-click anywhere on empty space to toggle view modes
document.addEventListener('dblclick', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
        btnToggleDock.click();
    }
});

// Quick Launcher Handlers
const linkExplorer = document.getElementById('link-explorer');
const linkCmd = document.getElementById('link-cmd');
const linkBrowser = document.getElementById('link-browser');
const linkTaskmgr = document.getElementById('link-taskmgr');

function sendLaunchMessage(app) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`launch:${app}`);
    } else {
        console.log(`Mock launching: ${app}`);
    }
}

if (linkExplorer) linkExplorer.addEventListener('click', () => sendLaunchMessage('explorer'));
if (linkCmd) linkCmd.addEventListener('click', () => sendLaunchMessage('cmd'));
if (linkBrowser) linkBrowser.addEventListener('click', () => sendLaunchMessage('browser'));
if (linkTaskmgr) linkTaskmgr.addEventListener('click', () => sendLaunchMessage('taskmgr'));

// Dock Mini Controller Event Listeners
const dockBtnAuto = document.getElementById('dock-btn-auto');
const dockBtnCurve = document.getElementById('dock-btn-curve');
const dockBtnManual = document.getElementById('dock-btn-manual');
const dockBtnSpeedDown = document.getElementById('dock-btn-speed-down');
const dockBtnSpeedUp = document.getElementById('dock-btn-speed-up');

if (dockBtnAuto) {
    dockBtnAuto.addEventListener('click', () => {
        if (appState.mode !== 'auto') {
            appState.mode = 'auto';
            updateUI();
            sendControl({ mode: 'auto' });
        }
    });
}
if (dockBtnCurve) {
    dockBtnCurve.addEventListener('click', () => {
        if (appState.mode !== 'curve') {
            appState.mode = 'curve';
            updateUI();
            sendControl({ mode: 'curve' });
        }
    });
}
if (dockBtnManual) {
    dockBtnManual.addEventListener('click', () => {
        if (appState.mode !== 'manual') {
            appState.mode = 'manual';
            updateUI();
            sendControl({ mode: 'manual', speed: appState.speed });
        }
    });
}
if (dockBtnSpeedDown) {
    dockBtnSpeedDown.addEventListener('click', () => {
        const val = Math.max(10, appState.speed - 5);
        updateSliderUI(val);
        sendControl({ mode: 'manual', speed: val });
    });
}
if (dockBtnSpeedUp) {
    dockBtnSpeedUp.addEventListener('click', () => {
        const val = Math.min(100, appState.speed + 5);
        updateSliderUI(val);
        sendControl({ mode: 'manual', speed: val });
    });
}

// Window Controls Handlers
const winMin = document.getElementById('win-min');
const winClose = document.getElementById('win-close');
const dockWinMin = document.getElementById('dock-win-min');
const dockWinToggle = document.getElementById('dock-win-toggle');
const dockWinClose = document.getElementById('dock-win-close');

function sendWindowMessage(action) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`window:${action}`);
    } else {
        console.log(`Window action: ${action}`);
    }
}

if (winMin) winMin.addEventListener('click', () => sendWindowMessage('minimize'));
if (winClose) winClose.addEventListener('click', () => sendWindowMessage('close'));
if (dockWinMin) dockWinMin.addEventListener('click', () => sendWindowMessage('minimize'));
if (dockWinClose) dockWinClose.addEventListener('click', () => sendWindowMessage('close'));
if (dockWinToggle) {
    dockWinToggle.addEventListener('click', () => {
        const toggleBtn = document.getElementById('btn-toggle-dock');
        if (toggleBtn) toggleBtn.click();
    });
}

// Drag Handles
document.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
        if (e.button === 0) { // Left mouse button
            // Prevent text selection
            e.preventDefault();
            if (window.chrome && window.chrome.webview) {
                window.chrome.webview.postMessage("drag");
            }
        }
    });
});

// System Tray Settings Checkbox logic
const chkMinimizeToTray = document.getElementById('chk-minimize-to-tray');
let minimizeToTray = localStorage.getItem('minimize_to_tray') !== 'false';
if (chkMinimizeToTray) {
    chkMinimizeToTray.checked = minimizeToTray;
    chkMinimizeToTray.addEventListener('change', (e) => {
        minimizeToTray = e.target.checked;
        localStorage.setItem('minimize_to_tray', minimizeToTray);
        sendSettingsToNative();
    });
}

function sendSettingsToNative() {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`settings:minimizeToTray:${minimizeToTray}`);
    }
}

// Receive messages from C# host (e.g. dock position snapping, file dialog paths)
if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
        const message = event.data;
        if (typeof message === 'string') {
            if (message.startsWith('dockPosition:')) {
                const position = message.substring(13);
                const container = document.querySelector('.app-container');
                if (position === 'top') {
                    container.classList.add('dock-top');
                    container.classList.remove('dock-bottom');
                } else {
                    container.classList.add('dock-bottom');
                    container.classList.remove('dock-top');
                }
            } else if (message.startsWith('selectedExe:')) {
                const path = message.substring(12);
                const pathField = document.getElementById('shortcut-path');
                const nameField = document.getElementById('shortcut-name');
                if (pathField) pathField.value = path;
                
                // Automatically set fallback name based on filename or folder name
                if (nameField && !nameField.value.trim()) {
                    let cleanPath = path;
                    if (cleanPath.endsWith('\\')) {
                        cleanPath = cleanPath.substring(0, cleanPath.length - 1);
                    }
                    const parts = cleanPath.split('\\');
                    const name = parts[parts.length - 1] || path; // Fallback to full path if split is empty
                    const nameWithoutExt = name.replace(/\.exe$/i, '');
                    nameField.value = nameWithoutExt;
                }
            }
        }
    });
}

// --- Custom Shortcut Manager Logic ---
const customShortcutsList = document.getElementById('custom-shortcuts-list');
const customLinksContainer = document.getElementById('custom-links-container');
const btnBrowseFile = document.getElementById('btn-browse-file');
const btnBrowseFolder = document.getElementById('btn-browse-folder');
const btnAddShortcut = document.getElementById('btn-add-shortcut');
const shortcutNameInput = document.getElementById('shortcut-name');
const shortcutPathInput = document.getElementById('shortcut-path');

let customShortcuts = [];
try {
    customShortcuts = JSON.parse(localStorage.getItem('custom_shortcuts') || '[]');
} catch (e) {
    customShortcuts = [];
}

function saveCustomShortcuts() {
    localStorage.setItem('custom_shortcuts', JSON.stringify(customShortcuts));
    renderCustomShortcuts();
}

function renderCustomShortcuts() {
    // 1. Render Manager List
    if (customShortcutsList) {
        customShortcutsList.innerHTML = '';
        if (customShortcuts.length === 0) {
            customShortcutsList.innerHTML = '<p class="setting-desc" style="text-align: center; margin: 10px 0;">No custom shortcuts added yet.</p>';
        } else {
            customShortcuts.forEach((shortcut, index) => {
                const row = document.createElement('div');
                row.className = 'shortcut-item-row';
                row.innerHTML = `
                    <div class="shortcut-item-info">
                        <span class="shortcut-item-name color-${shortcut.color || 'blue'}">${shortcut.name}</span>
                        <span class="shortcut-item-path" title="${shortcut.path}">${shortcut.path}</span>
                    </div>
                    <button class="shortcut-delete-btn" data-index="${index}">Delete</button>
                `;
                customShortcutsList.appendChild(row);
            });
            
            // Wire delete buttons
            customShortcutsList.querySelectorAll('.shortcut-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const index = parseInt(e.target.dataset.index, 10);
                    customShortcuts.splice(index, 1);
                    saveCustomShortcuts();
                });
            });
        }
    }

    // 2. Render Launcher Buttons in Dock Bar
    if (customLinksContainer) {
        customLinksContainer.innerHTML = '';
        customShortcuts.forEach((shortcut) => {
            const btn = document.createElement('button');
            btn.className = `quick-link-btn custom-shortcut-btn color-${shortcut.color || 'blue'}`;
            // Use first letter of name as display character
            btn.textContent = (shortcut.name || '?').substring(0, 1).toUpperCase();
            btn.title = `Launch ${shortcut.name}\n${shortcut.path}`;
            btn.addEventListener('click', () => {
                if (window.chrome && window.chrome.webview) {
                    window.chrome.webview.postMessage(`launchCustom:${shortcut.path}`);
                } else {
                    console.log(`Mock launching custom: ${shortcut.path}`);
                }
            });
            customLinksContainer.appendChild(btn);
        });
    }
}

// Browse File event
if (btnBrowseFile) {
    btnBrowseFile.addEventListener('click', () => {
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage("browse:file");
        } else {
            // Mock selected path when running outside native host
            const mockPath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
            const pathField = document.getElementById('shortcut-path');
            const nameField = document.getElementById('shortcut-name');
            if (pathField) pathField.value = mockPath;
            if (nameField) nameField.value = "Chrome";
        }
    });
}

// Browse Folder event
if (btnBrowseFolder) {
    btnBrowseFolder.addEventListener('click', () => {
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage("browse:folder");
        } else {
            // Mock selected folder path when running outside native host
            const mockPath = "D:\\Games";
            const pathField = document.getElementById('shortcut-path');
            const nameField = document.getElementById('shortcut-name');
            if (pathField) pathField.value = mockPath;
            if (nameField) nameField.value = "Games";
        }
    });
}

// Add Shortcut event
if (btnAddShortcut) {
    btnAddShortcut.addEventListener('click', () => {
        const name = shortcutNameInput.value.trim();
        const path = shortcutPathInput.value.trim();
        if (!name || !path) {
            alert('Please enter both shortcut name and target path/URL.');
            return;
        }

        // Get selected color radio
        const colorRadio = document.querySelector('input[name="shortcut-color"]:checked');
        const color = colorRadio ? colorRadio.value : 'blue';

        customShortcuts.push({ name, path, color });
        saveCustomShortcuts();

        // Clear inputs
        shortcutNameInput.value = '';
        shortcutPathInput.value = '';
    });
}

// --- Theme Manager Logic ---
function hexToRgba(hex, alpha = 0.4) {
    let c = hex.substring(1);
    if (c.length === 3) {
        c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

let customThemeConfig = {
    auto: '#39ff14',
    curve: '#bd00ff',
    manual: '#00e5ff'
};

try {
    const saved = localStorage.getItem('custom_theme_config');
    if (saved) {
        customThemeConfig = { ...customThemeConfig, ...JSON.parse(saved) };
    }
} catch (e) {
    console.error('Failed to load custom theme config:', e);
}

const themes = {
    cyberpunk: {
        auto: { color: '#39ff14', glow: 'rgba(57, 255, 20, 0.4)' },
        curve: { color: '#bd00ff', glow: 'rgba(189, 0, 255, 0.4)' },
        manual: { color: '#00e5ff', glow: 'rgba(0, 229, 255, 0.4)' },
        safety: { color: '#ff3300', glow: 'rgba(255, 51, 0, 0.4)' }
    },
    volcanic: {
        auto: { color: '#ffd700', glow: 'rgba(255, 215, 0, 0.4)' },
        curve: { color: '#ff7f00', glow: 'rgba(255, 127, 0, 0.4)' },
        manual: { color: '#ff003c', glow: 'rgba(255, 0, 60, 0.4)' },
        safety: { color: '#ff3300', glow: 'rgba(255, 51, 0, 0.4)' }
    },
    forest: {
        auto: { color: '#00e676', glow: 'rgba(0, 230, 118, 0.4)' },
        curve: { color: '#00b0ff', glow: 'rgba(0, 176, 255, 0.4)' },
        manual: { color: '#1de9b6', glow: 'rgba(29, 233, 182, 0.4)' },
        safety: { color: '#ff3300', glow: 'rgba(255, 51, 0, 0.4)' }
    },
    sunset: {
        auto: { color: '#ff007f', glow: 'rgba(255, 0, 127, 0.4)' },
        curve: { color: '#ff6b6b', glow: 'rgba(255, 107, 107, 0.4)' },
        manual: { color: '#6c5ce7', glow: 'rgba(108, 92, 231, 0.4)' },
        safety: { color: '#ff3300', glow: 'rgba(255, 51, 0, 0.4)' }
    },
    amethyst: {
        auto: { color: '#e040fb', glow: 'rgba(224, 64, 251, 0.4)' },
        curve: { color: '#7b1fa2', glow: 'rgba(123, 31, 162, 0.4)' },
        manual: { color: '#00e5ff', glow: 'rgba(0, 229, 255, 0.4)' },
        safety: { color: '#ff3300', glow: 'rgba(255, 51, 0, 0.4)' }
    },
    custom: {
        auto: { color: customThemeConfig.auto, glow: hexToRgba(customThemeConfig.auto, 0.4) },
        curve: { color: customThemeConfig.curve, glow: hexToRgba(customThemeConfig.curve, 0.4) },
        manual: { color: customThemeConfig.manual, glow: hexToRgba(customThemeConfig.manual, 0.4) },
        safety: { color: '#ff3300', glow: 'rgba(255, 51, 0, 0.4)' }
    }
};

let currentTheme = localStorage.getItem('app_theme') || 'cyberpunk';

function updateCustomThemeUI() {
    const pickerAuto = document.getElementById('picker-color-auto');
    const pickerCurve = document.getElementById('picker-color-curve');
    const pickerManual = document.getElementById('picker-color-manual');
    
    if (pickerAuto) pickerAuto.value = customThemeConfig.auto;
    if (pickerCurve) pickerCurve.value = customThemeConfig.curve;
    if (pickerManual) pickerManual.value = customThemeConfig.manual;
    
    const lblAuto = document.getElementById('hex-color-auto');
    const lblCurve = document.getElementById('hex-color-curve');
    const lblManual = document.getElementById('hex-color-manual');
    
    if (lblAuto) lblAuto.textContent = customThemeConfig.auto.toUpperCase();
    if (lblCurve) lblCurve.textContent = customThemeConfig.curve.toUpperCase();
    if (lblManual) lblManual.textContent = customThemeConfig.manual.toUpperCase();

    const previewAuto = document.querySelector('.custom-auto-preview');
    const previewCurve = document.querySelector('.custom-curve-preview');
    const previewManual = document.querySelector('.custom-manual-preview');
    
    if (previewAuto) previewAuto.style.backgroundColor = customThemeConfig.auto;
    if (previewCurve) previewCurve.style.backgroundColor = customThemeConfig.curve;
    if (previewManual) previewManual.style.backgroundColor = customThemeConfig.manual;
}

function applyTheme(themeName) {
    currentTheme = themeName;
    localStorage.setItem('app_theme', themeName);
    
    const activeTheme = themes[themeName] || themes.cyberpunk;
    
    // Set CSS variables for modes
    document.documentElement.style.setProperty('--color-auto', activeTheme.auto.color);
    document.documentElement.style.setProperty('--color-auto-glow', activeTheme.auto.glow);
    document.documentElement.style.setProperty('--color-curve', activeTheme.curve.color);
    document.documentElement.style.setProperty('--color-curve-glow', activeTheme.curve.glow);
    document.documentElement.style.setProperty('--color-manual', activeTheme.manual.color);
    document.documentElement.style.setProperty('--color-manual-glow', activeTheme.manual.glow);
    
    // Update theme card active styles in UI
    document.querySelectorAll('.theme-card').forEach(card => {
        if (card.dataset.theme === themeName) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    // Toggle custom builder panel
    const builder = document.getElementById('custom-theme-builder');
    if (builder) {
        if (themeName === 'custom') {
            builder.classList.add('active');
            builder.classList.remove('collapsed');
        } else {
            builder.classList.remove('active');
            builder.classList.add('collapsed');
        }
    }
    
    // Update Chart.js dataset colors
    if (historyChart) {
        historyChart.data.datasets[0].borderColor = activeTheme.auto.color; // CPU Temp
        historyChart.data.datasets[0].backgroundColor = activeTheme.auto.glow.replace('0.4', '0.1');
        
        historyChart.data.datasets[1].borderColor = activeTheme.curve.color; // GPU Temp
        historyChart.data.datasets[1].backgroundColor = activeTheme.curve.glow.replace('0.4', '0.1');
        
        historyChart.data.datasets[2].borderColor = activeTheme.manual.color; // Fan Speed
        historyChart.data.datasets[2].backgroundColor = activeTheme.manual.glow.replace('0.4', '0.05');
        
        historyChart.update('none'); // Update immediately without animation
    }
    
    updateUI();
}

function initCustomThemeEvents() {
    const bindPicker = (id, key) => {
        const picker = document.getElementById(id);
        if (picker) {
            picker.addEventListener('input', (e) => {
                const hex = e.target.value;
                customThemeConfig[key] = hex;
                
                // Update theme value inside active theme reference
                themes.custom[key] = { color: hex, glow: hexToRgba(hex, 0.4) };
                
                updateCustomThemeUI();
                
                if (currentTheme === 'custom') {
                    applyTheme('custom');
                }
            });
            picker.addEventListener('change', (e) => {
                const hex = e.target.value;
                customThemeConfig[key] = hex;
                localStorage.setItem('custom_theme_config', JSON.stringify(customThemeConfig));
            });
        }
    };
    
    bindPicker('picker-color-auto', 'auto');
    bindPicker('picker-color-curve', 'curve');
    bindPicker('picker-color-manual', 'manual');

    // Theme card click listeners
    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
            applyTheme(card.dataset.theme);
        });
    });
}

// Initialization
applyScale(currentScale);
updateCustomThemeUI();
initCustomThemeEvents();
applyTheme(currentTheme); // Apply accent theme on load
sendSettingsToNative();
renderCustomShortcuts(); // Render custom shortcuts on load
updateSliderUI(appState.speed);
fetchStatus();
setInterval(fetchStatus, 1000);

