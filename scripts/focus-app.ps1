# Brings the running Skylines window to the front (Windows) so the Tauri MCP bridge wakes up.
Add-Type -Name W -Namespace N -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
'@
$p = Get-Process skylines -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "skylines window not found"; exit 1 }
[N.W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[N.W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Write-Output "focused"
