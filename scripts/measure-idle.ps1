# Measures Buddy's CPU use while idle: starts a separate copy (its own profile, no API calls), lets it settle, then
# samples each of its processes over a quiet window. Keep the mouse still while it runs; moving it is real work
# (Buddy's pointer follows the cursor) and shows up in the numbers.
# It also reports memory: the working set of all of Buddy's processes at the start and end of the quiet window, and
# how much it grew.
#   powershell -File scripts/measure-idle.ps1 [-Seconds 60] [-Budget 1.0] [-MemoryMB 200]
# Exits 1 when the total CPU is over -Budget (percent of one core) or the memory at the end is over -MemoryMB.
param([int]$Seconds = 60, [double]$Budget = 0, [double]$MemoryMB = 0)

$app = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path ([IO.Path]::GetTempPath()) "buddy-idle-$PID"
$env:ANTHROPIC_API_KEY = "sk-not-used-while-idle"
$env:BUDDY_MODELS_DIR = Join-Path $env:APPDATA "desktop-buddy\models"
$electron = Join-Path $app "node_modules\electron\dist\electron.exe"

Start-Process -FilePath $electron -ArgumentList @("`"$app`"", "--user-data-dir=`"$profileDir`"") | Out-Null
Start-Sleep -Seconds 12
$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape("buddy-idle-$PID") }
$kind = @{}
foreach ($p in $procs) {
  $kind[$p.ProcessId] = if ($p.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { "main" }
}
$before = @{}
$memBefore = @{}
foreach ($id in $kind.Keys) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  $before[$id] = $p.CPU
  $memBefore[$id] = $p.WorkingSet64
}
Start-Sleep -Seconds $Seconds
$rows = foreach ($id in $kind.Keys) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  [pscustomobject]@{ type = $kind[$id]; pct = (($p.CPU - $before[$id]) / $Seconds) * 100; mb = $p.WorkingSet64 / 1MB; startMb = $memBefore[$id] / 1MB }
}
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force $profileDir -ErrorAction SilentlyContinue

$total = ($rows | Measure-Object pct -Sum).Sum
"Idle CPU over {0} s: {1:N2}% of one core" -f $Seconds, $total
$rows | Group-Object type | ForEach-Object { "  {0,-12} x{1,-3} {2,6:N2}%  {3,7:N0} MB" -f $_.Name, $_.Count, ($_.Group | Measure-Object pct -Sum).Sum, ($_.Group | Measure-Object mb -Sum).Sum }
$mem = ($rows | Measure-Object mb -Sum).Sum
$startMem = ($rows | Measure-Object startMb -Sum).Sum
"Memory: {0:N0} MB at the end, {1:N0} MB at the start ({2:+0;-0} MB)" -f $mem, $startMem, ($mem - $startMem)
$over = $false
if ($Budget -gt 0 -and $total -gt $Budget) {
  "CPU over budget ({0:N2}% > {1:N2}%)" -f $total, $Budget
  $over = $true
}
if ($MemoryMB -gt 0 -and $mem -gt $MemoryMB) {
  "Memory over budget ({0:N0} MB > {1:N0} MB)" -f $mem, $MemoryMB
  $over = $true
}
if ($over) { exit 1 }
