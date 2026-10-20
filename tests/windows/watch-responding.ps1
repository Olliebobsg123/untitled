# Starts the app normally and samples Process.Responding (the same check
# that makes Windows add "Not Responding" to a window title).
param([string]$Exe, [int]$Seconds = 60, [string]$Label = "run")
New-Item -ItemType Directory -Force -Path "$PSScriptRoot\out" | Out-Null
$log = "$PSScriptRoot\out\$Label-stdout.txt"
$env:ELECTRON_ENABLE_LOGGING = "1"
$p = Start-Process -FilePath $Exe -PassThru -RedirectStandardOutput $log -RedirectStandardError "$PSScriptRoot\out\$Label-stderr.txt"
$start = Get-Date; $bad = $null; $badTotal = 0; $firstWindow = $null
while (((Get-Date) - $start).TotalSeconds -lt $Seconds) {
  Start-Sleep -Milliseconds 500
  $all = Get-Process -Name 'Lighting Console' -ErrorAction SilentlyContinue
  $main = $all | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  $t = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
  if (-not $main) { continue }
  if (-not $firstWindow) { $firstWindow = $t; "[$Label] window appeared at ${t}s: '$($main.MainWindowTitle)'" }
  if (-not $main.Responding) { if (-not $bad) { $bad = $t; "[$Label] NOT RESPONDING from ${t}s (title '$($main.MainWindowTitle)')" } }
  elseif ($bad) { "[$Label] responding again at ${t}s (stalled $([math]::Round($t-$bad,1))s)"; $badTotal += $t - $bad; $bad = $null }
}
if ($bad) { "[$Label] STILL NOT RESPONDING at end (since ${bad}s)" }
"[$Label] processes: " + ((Get-Process -Name 'Lighting Console' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) cpu=$([math]::Round($_.CPU,1))s mem=$([math]::Round($_.WorkingSet64/1MB))MB" }) -join '; ')
"[$Label] total not-responding: $badTotal s"
Get-Process -Name 'Lighting Console' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
"----- stdout -----"; Get-Content $log -ErrorAction SilentlyContinue | Select-Object -First 120
"----- stderr -----"; Get-Content "$PSScriptRoot\out\$Label-stderr.txt" -ErrorAction SilentlyContinue | Select-Object -First 80
