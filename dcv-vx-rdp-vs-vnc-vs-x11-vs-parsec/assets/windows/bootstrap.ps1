$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$logPath = 'C:\ProgramData\benchmark-bootstrap.log'
Start-Transcript -Path $logPath -Append

Write-Host 'Enabling RDP and firewall rule.'
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Value 0
Enable-NetFirewallRule -DisplayGroup 'Remote Desktop'

if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Chocolatey.'
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
}

$packages = @(
  'googlechrome',
  'tigervnc',
  'parsec',
  'nice-dcv-server'
)

foreach ($pkg in $packages) {
  try {
    Write-Host "Installing $pkg"
    choco install -y $pkg
  }
  catch {
    Write-Warning "Failed to install $pkg. Continue with manual remediation."
  }
}

$overlayPath = 'C:\ProgramData\latency-overlay.ps1'
@'
Add-Type -AssemblyName PresentationFramework

$window = New-Object Windows.Window
$window.Title = 'Latency Overlay'
$window.WindowStyle = 'None'
$window.ResizeMode = 'NoResize'
$window.WindowStartupLocation = 'CenterScreen'
$window.WindowState = 'Maximized'
$window.Background = 'Black'
$window.Topmost = $true

$text = New-Object Windows.Controls.TextBlock
$text.FontFamily = 'Consolas'
$text.FontSize = 42
$text.Foreground = 'Lime'
$text.HorizontalAlignment = 'Center'
$text.VerticalAlignment = 'Center'

$grid = New-Object Windows.Controls.Grid
$grid.Children.Add($text) | Out-Null
$window.Content = $grid

$counter = 0
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(16)
$timer.Add_Tick({
  $counter++
  $epochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $text.Text = "SERVER_EPOCH_MS=$epochMs FRAME=$counter"
})
$timer.Start()

$window.ShowDialog() | Out-Null
'@ | Set-Content -Path $overlayPath -Encoding UTF8

$taskName = 'LatencyOverlayAtLogon'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument "-ExecutionPolicy Bypass -File $overlayPath"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -RunLevel Highest -Description 'Launch overlay for visual latency benchmark.' | Out-Null

Write-Host 'Bootstrap completed. Parsec requires manual sign-in (personal account).'
Stop-Transcript
