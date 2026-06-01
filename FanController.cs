using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

public class FanControllerApp {
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [STAThread]
    public static void Main() {
        try {
            SetProcessDPIAware();
        } catch {}
        EnsureServerRunning();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new DockForm());
    }

    private static void EnsureServerRunning() {
        try {
            System.Net.Sockets.TcpClient tcpClient = new System.Net.Sockets.TcpClient();
            var ar = tcpClient.BeginConnect("127.0.0.1", 3000, null, null);
            if (!ar.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(200), false)) {
                tcpClient.Close();
                throw new Exception("Timeout");
            }
            tcpClient.EndConnect(ar);
            tcpClient.Close();
        } catch {
            string scriptPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server.ps1");
            if (File.Exists(scriptPath)) {
                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = "powershell.exe",
                    Arguments = "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
        }
    }
}

public class DockForm : Form {
    private WebView2 webView;
    private System.Windows.Forms.Timer monitorTimer;
    private int dockHeight = 48;
    private int standardHeight = 720;
    private int currentHeight;
    private int currentWidth;
    private int screenWidth;
    private int screenHeight;
    
    private int targetYVisible;
    private bool isDockedAtTop = false;
    private bool isDockLayout = false;
    private int taskbarHeight;

    private bool isDragging = false;
    private int dragOffsetX = 0;
    private int dragOffsetY = 0;
    private int currentWindowX = 0;
    private int currentWindowY = 0;

    private NotifyIcon trayIcon;
    private ContextMenuStrip trayMenu;
    private bool minimizeToTray = true;
    private bool isTransitioning = false;

    // Win32 API structures
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct APPBARDATA {
        public int cbSize;
        public IntPtr hWnd;
        public int uCallbackMessage;
        public int uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;

    [DllImport("shell32.dll")]
    private static extern IntPtr SHAppBarMessage(int dwMessage, ref APPBARDATA pData);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern int RegisterWindowMessage(string lpString);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    private const int GWL_STYLE = -16;
    private const int WS_CAPTION = 0x00C00000;

    private const int ABM_NEW = 0;
    private const int ABM_REMOVE = 1;
    private const int ABM_QUERYPOS = 2;
    private const int ABM_SETPOS = 3;

    private const int ABE_TOP = 1;
    private const int ABE_BOTTOM = 3;

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
    
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private bool isAppBarRegistered = false;
    private int appBarCallbackMessage;

    public DockForm() {
        // Form Setup
        this.Text = "Dell Server Fan Controller";
        this.FormBorderStyle = FormBorderStyle.Sizable;
        this.ShowInTaskbar = true;
        this.TopMost = false;
        this.BackColor = Color.FromArgb(29, 9, 48);

        try {
            this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        } catch {
            this.Icon = SystemIcons.Application;
        }

        screenWidth = Screen.PrimaryScreen.Bounds.Width;
        screenHeight = Screen.PrimaryScreen.Bounds.Height;
        taskbarHeight = screenHeight - Screen.PrimaryScreen.WorkingArea.Height;
        
        currentHeight = standardHeight;
        currentWidth = 1000;

        UpdateDockCoordinates();

        this.Size = new Size(currentWidth, currentHeight);
        int startX = (screenWidth - currentWidth) / 2;
        this.Location = new Point(startX, targetYVisible);
        currentWindowX = startX;
        currentWindowY = targetYVisible;

        // Initialize WebView2
        webView = new WebView2();
        webView.Dock = DockStyle.Fill;
        this.Controls.Add(webView);
        
        InitializeWebView();

        // Setup Monitor Timer
        monitorTimer = new System.Windows.Forms.Timer();
        monitorTimer.Interval = 50;
        monitorTimer.Tick += MonitorTimer_Tick;
        monitorTimer.Start();

        // Initialize Tray Icon
        try {
            trayIcon = new NotifyIcon();
            trayIcon.Text = "Dell Server Fan Controller";
            try {
                trayIcon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            } catch {
                trayIcon.Icon = SystemIcons.Application;
            }
            
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Open / Restore", null, OnTrayRestore);
            trayMenu.Items.Add("Exit", null, OnTrayExit);
            trayIcon.ContextMenuStrip = trayMenu;
            
            trayIcon.DoubleClick += OnTrayRestore;
            trayIcon.Visible = true;
        } catch (Exception ex) {
            Console.WriteLine("Failed to init tray icon: " + ex.Message);
        }
    }

    private async void InitializeWebView() {
        try {
            string tempFolder = Path.Combine(Path.GetTempPath(), "FanController_Cache");
            var env = await CoreWebView2Environment.CreateAsync(null, tempFolder, null);
            await webView.EnsureCoreWebView2Async(env);
            
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            
            webView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
            webView.Source = new Uri("http://localhost:3000");
        } catch (Exception ex) {
            MessageBox.Show("Failed to initialize WebView2:\n\n" + ex.ToString(), "WebView2 Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
        string message = e.TryGetWebMessageAsString();
        if (message.StartsWith("dock")) {
            isTransitioning = true;
            isDockLayout = true;
            int height = dockHeight;
            double scale = 1.0;
            if (message.Contains(":")) {
                string[] parts = message.Split(':');
                if (parts.Length > 1) int.TryParse(parts[1], out height);
                if (parts.Length > 2) double.TryParse(parts[2], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out scale);
            }
            currentHeight = height;
            currentWidth = screenWidth;
            this.FormBorderStyle = FormBorderStyle.None;
            this.TopMost = true;
            this.ShowInTaskbar = false; 
            RegisterAppBar();
            if (isAppBarRegistered) {
                SizeAppBar();
            } else {
                UpdateDockCoordinates();
                this.Size = new Size(currentWidth, currentHeight);
                this.Location = new Point(0, targetYVisible);
            }
            isTransitioning = false;
        } else if (message.StartsWith("standard")) {
            isTransitioning = true;
            bool wasDock = (this.FormBorderStyle == FormBorderStyle.None);
            isDockLayout = false;
            int height = standardHeight;
            double scale = 1.0;
            if (message.Contains(":")) {
                string[] parts = message.Split(':');
                if (parts.Length > 1) int.TryParse(parts[1], out height);
                if (parts.Length > 2) double.TryParse(parts[2], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out scale);
            }
            
            // Clamp physical standard window size to screen boundaries
            int maxH = screenHeight - taskbarHeight;
            currentHeight = Math.Min(height, maxH);
            currentWidth = Math.Min((int)Math.Round(1000 * scale), screenWidth);
            
            this.FormBorderStyle = FormBorderStyle.Sizable;
            this.TopMost = false;
            this.ShowInTaskbar = true; 
            UnregisterAppBar();
            
            this.Size = new Size(currentWidth, currentHeight);
            if (wasDock) {
                // Center the window on transition from dock
                int targetX = (screenWidth - currentWidth) / 2;
                int targetY = (screenHeight - taskbarHeight - currentHeight) / 2;
                this.Location = new Point(targetX, targetY);
            }
            isTransitioning = false;
        } else if (message.StartsWith("launch:")) {
            string app = message.Substring(7);
            try {
                if (app == "explorer") {
                    Process.Start("explorer.exe", "\"" + AppDomain.CurrentDomain.BaseDirectory + "\"");
                } else if (app == "cmd") {
                    ProcessStartInfo psi = new ProcessStartInfo {
                        FileName = "powershell.exe",
                        UseShellExecute = true
                    };
                    Process.Start(psi);
                } else if (app == "browser") {
                    ProcessStartInfo psi = new ProcessStartInfo {
                        FileName = "http://localhost:3000",
                        UseShellExecute = true
                    };
                    Process.Start(psi);
                } else if (app == "taskmgr") {
                    Process.Start("taskmgr.exe");
                }
            } catch (Exception ex) {
                Console.WriteLine("Launch error: " + ex.Message);
            }
        } else if (message == "drag") {
            try {
                UnregisterAppBar(); 
                ReleaseCapture();
                SendMessage(this.Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
 
                POINT p;
                GetCursorPos(out p);
 
                if (p.Y < (screenHeight / 2)) {
                    isDockedAtTop = true;
                } else {
                    isDockedAtTop = false;
                }
 
                if (isDockLayout) {
                    RegisterAppBar();
                    if (isAppBarRegistered) {
                        SizeAppBar();
                    }
                } else {
                    UpdateDockCoordinates();
                    currentWindowX = (screenWidth - currentWidth) / 2;
                    currentWindowY = targetYVisible;
                    this.Location = new Point(currentWindowX, currentWindowY);
                }
            } catch (Exception ex) {
                Console.WriteLine("Drag error: " + ex.Message);
            }
        } else if (message.StartsWith("window:")) {
            string action = message.Substring(7);
            if (action == "minimize") {
                this.WindowState = FormWindowState.Minimized;
            } else if (action == "close") {
                Application.Exit();
            }
            return;
        } else if (message.StartsWith("settings:")) {
            string[] parts = message.Split(':');
            if (parts.Length > 2 && parts[1] == "minimizeToTray") {
                bool.TryParse(parts[2], out minimizeToTray);
            }
            return;
        } else if (message == "browse:file") {
            try {
                using (OpenFileDialog ofd = new OpenFileDialog()) {
                    ofd.Filter = "Executable Files (*.exe)|*.exe|All Files (*.*)|*.*";
                    ofd.Title = "Select File or Program Shortcut";
                    if (ofd.ShowDialog() == DialogResult.OK) {
                        string escapedPath = ofd.FileName.Replace("\\", "\\\\");
                        webView.CoreWebView2.PostWebMessageAsString("selectedExe:" + escapedPath);
                    }
                }
            } catch (Exception ex) {
                MessageBox.Show("Error opening file dialog:\n\n" + ex.Message, "File Dialog Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return;
        } else if (message == "browse:folder") {
            try {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {
                    fbd.Description = "Select Folder or Drive Shortcut";
                    fbd.ShowNewFolderButton = true;
                    if (fbd.ShowDialog() == DialogResult.OK) {
                        string escapedPath = fbd.SelectedPath.Replace("\\", "\\\\");
                        webView.CoreWebView2.PostWebMessageAsString("selectedExe:" + escapedPath);
                    }
                }
            } catch (Exception ex) {
                MessageBox.Show("Error opening folder browser:\n\n" + ex.Message, "Folder Browser Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return;
        } else if (message.StartsWith("launchCustom:")) {
            string target = message.Substring(13);
            try {
                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = target,
                    UseShellExecute = true
                };
                Process.Start(psi);
            } catch (Exception ex) {
                MessageBox.Show("Failed to launch shortcut:\n\n" + ex.Message, "Launch Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return;
        }

    }

    private void UpdateDockCoordinates() {
        if (isDockLayout) {
            if (isDockedAtTop) {
                targetYVisible = 0;
            } else {
                targetYVisible = screenHeight - taskbarHeight - currentHeight;
            }
        } else {
            targetYVisible = (screenHeight - taskbarHeight - currentHeight) / 2;
        }
    }

    private void RegisterAppBar() {
        if (isAppBarRegistered) return;

        APPBARDATA abd = new APPBARDATA();
        abd.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
        abd.hWnd = this.Handle;
        
        appBarCallbackMessage = RegisterWindowMessage("AppBarMessageCallback");
        abd.uCallbackMessage = appBarCallbackMessage;

        SHAppBarMessage(ABM_NEW, ref abd);
        isAppBarRegistered = true;

        SizeAppBar();
    }

    private void UnregisterAppBar() {
        if (!isAppBarRegistered) return;

        APPBARDATA abd = new APPBARDATA();
        abd.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
        abd.hWnd = this.Handle;
        SHAppBarMessage(ABM_REMOVE, ref abd);
        isAppBarRegistered = false;
    }

    private void SizeAppBar() {
        if (!isAppBarRegistered) return;

        APPBARDATA abd = new APPBARDATA();
        abd.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
        abd.hWnd = this.Handle;
        abd.uEdge = isDockedAtTop ? ABE_TOP : ABE_BOTTOM;

        abd.rc = new RECT();
        abd.rc.Left = 0;
        abd.rc.Right = screenWidth;
        if (isDockedAtTop) {
            abd.rc.Top = 0;
            abd.rc.Bottom = currentHeight;
        } else {
            abd.rc.Top = screenHeight - currentHeight;
            abd.rc.Bottom = screenHeight;
        }

        SHAppBarMessage(ABM_QUERYPOS, ref abd);

        if (abd.uEdge == ABE_TOP) {
            abd.rc.Bottom = abd.rc.Top + currentHeight;
        } else {
            abd.rc.Top = abd.rc.Bottom - currentHeight;
        }

        SHAppBarMessage(ABM_SETPOS, ref abd);

        this.Location = new Point(abd.rc.Left, abd.rc.Top);
        this.Size = new Size(abd.rc.Right - abd.rc.Left, abd.rc.Bottom - abd.rc.Top);

        // Notify HTML frontend of dock position
        try {
            if (webView != null && webView.CoreWebView2 != null) {
                webView.CoreWebView2.PostWebMessageAsString("dockPosition:" + (isDockedAtTop ? "top" : "bottom"));
            }
        } catch {}
    }

    protected override void WndProc(ref Message m) {
        base.WndProc(ref m);
        if (isAppBarRegistered && m.Msg == appBarCallbackMessage) {
            SizeAppBar();
        }
    }

    private void MonitorTimer_Tick(object sender, EventArgs e) {
        POINT p;
        if (!GetCursorPos(out p)) return;

        // --- Drag & Snap (Hold Ctrl + Left Click) ---
        bool ctrlPressed = (GetAsyncKeyState(0x11) & 0x8000) != 0; // VK_CONTROL
        bool lButtonDown = (GetAsyncKeyState(0x01) & 0x8000) != 0; // VK_LBUTTON

        if (ctrlPressed && lButtonDown) {
            if (!isDragging) {
                if (p.X >= this.Left && p.X <= (this.Left + this.Width) &&
                    p.Y >= this.Top && p.Y <= (this.Top + this.Height)) {
                    isDragging = true;
                    dragOffsetX = p.X - currentWindowX;
                    dragOffsetY = p.Y - currentWindowY;
                    UnregisterAppBar(); // Temporarily unregister during dragging
                }
            }
            
            if (isDragging) {
                currentWindowX = p.X - dragOffsetX;
                currentWindowY = p.Y - dragOffsetY;
                this.Location = new Point(currentWindowX, currentWindowY);
                return;
            }
        }
        else if (isDragging) {
            isDragging = false;
            if (currentWindowY < (screenHeight / 2)) {
                isDockedAtTop = true;
            } else {
                isDockedAtTop = false;
            }

            if (isDockLayout) {
                RegisterAppBar(); // Re-register at new edge
            } else {
                UpdateDockCoordinates();
                currentWindowX = (screenWidth - currentWidth) / 2;
                currentWindowY = targetYVisible;
                this.Location = new Point(currentWindowX, currentWindowY);
            }
            return;
        }

        // --- HIDE DOCK IF ANOTHER APP GOES EXCLUSIVE FULLSCREEN ---
        IntPtr hwndFore = GetForegroundWindow();
        if (hwndFore != IntPtr.Zero && hwndFore != this.Handle) {
            RECT rcFore;
            if (GetWindowRect(hwndFore, out rcFore)) {
                bool isSizeMatch = (rcFore.Right - rcFore.Left >= screenWidth) && (rcFore.Bottom - rcFore.Top >= screenHeight);
                int style = GetWindowLong(hwndFore, GWL_STYLE);
                bool isForeFullscreen = isSizeMatch && ((style & WS_CAPTION) != WS_CAPTION);
                if (isForeFullscreen) {
                    if (this.TopMost) {
                        this.TopMost = false;
                        SetWindowPos(this.Handle, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
                    }
                } else {
                    if (!this.TopMost) {
                        this.TopMost = true;
                    }
                }
            }
        }
    }

    protected override void OnSizeChanged(EventArgs e) {
        base.OnSizeChanged(e);
        if (this.WindowState == FormWindowState.Minimized) {
            if (minimizeToTray) {
                this.Hide();
                if (trayIcon != null) {
                    trayIcon.ShowBalloonTip(2000, "Fan Controller Backgrounded", "Double-click the tray icon to restore.", ToolTipIcon.Info);
                }
            }
        } else if (this.WindowState == FormWindowState.Normal) {
            if (!isDockLayout && !isTransitioning) {
                currentWidth = this.Width;
                currentHeight = this.Height;
            }
        }
    }

    private void OnTrayRestore(object sender, EventArgs e) {
        this.Show();
        this.WindowState = FormWindowState.Normal;
        this.Activate();
    }

    private void OnTrayExit(object sender, EventArgs e) {
        Application.Exit();
    }

    protected override void OnFormClosing(FormClosingEventArgs e) {
        UnregisterAppBar();
        if (trayIcon != null) {
            trayIcon.Visible = false;
            trayIcon.Dispose();
        }
        base.OnFormClosing(e);
    }

    protected override void OnKeyDown(KeyEventArgs e) {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) {
            Application.Exit();
        }
    }
}
