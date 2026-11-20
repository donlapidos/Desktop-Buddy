# The wall around Buddy's PowerShell commands (roadmap 3.1; pc-tools.js runs it). A command runs inside a Windows
# AppContainer, the sandbox Windows gives Store apps: it can read Windows itself, read and change Buddy's working folder
# (granted here), and nothing else of the user's, and it has no network. No administrator rights or setup are needed.
#
# Inside, the command finds the working folder's full path in $Work and uses full paths: PowerShell 5.1 can't make a
# folder inside the sandbox its current location (Set-Location checks every folder from C:\ down, which a sandbox may
# not look into), but its file commands work on full paths. Files made before the command ran can be moved and renamed
# but not deleted, and the Recycle Bin is outside: commands set files aside in a "Removed" folder instead.
#
#   powershell -File wall.ps1 -WorkDir <folder> -Encoded <base64 UTF-16 command> [-Name <container>] [-Cache <folder>]
#                             [-Shipped <folder>]
# The command's output (errors as plain text) and exit code are this script's. -Shipped is where the installer put the
# launcher, built when Buddy was released, so nothing is compiled on the user's PC. Otherwise (Buddy run from source,
# or a launcher that doesn't match this script) it's compiled into -Cache once, so later commands skip compiling it.
# -Remove deletes the container and its grant on -WorkDir. -Build only compiles the launcher into -Cache (the release
# does this: scripts/build-native.mjs).
param(
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [string]$Encoded = "",
  [string]$Name = "DesktopBuddy.Commands",
  [string]$Cache = "",
  [string]$Shipped = "",
  [switch]$Remove,
  [switch]$Build
)
$ErrorActionPreference = "Stop"

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class BuddyWall {
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSid(IntPtr sid, out string s);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr retSize);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

  /// A job that ends everything in it when this launcher ends (however it ends: Buddy stopping it, a timeout).
  static IntPtr KillWithMe() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    int size = Marshal.SizeOf(info);
    IntPtr p = Marshal.AllocHGlobal(size); Marshal.StructureToPtr(info, p, false);
    if (!SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, p, (uint)size)) throw new Win32Exception();
    return job;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern int GetLongPathName(string shortPath, StringBuilder longPath, int size);

  /// A folder's full name ("C:\Users\Sam Smith" for "C:\Users\SAMSMI~1"): inside the wall, PowerShell can't look into the
  /// folders above it to work a short name out.
  public static string LongPath(string path) {
    var sb = new StringBuilder(32768);
    return GetLongPathName(path, sb, sb.Capacity) > 0 ? sb.ToString() : path;
  }

  /// The container's SID, making the container the first time.
  public static string Sid(string name) {
    IntPtr sid;
    if (CreateAppContainerProfile(name, name, "Desktop Buddy's commands", IntPtr.Zero, 0, out sid) != 0) {
      int hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
      if (hr != 0) throw new Win32Exception(hr);
    }
    string s; ConvertSidToStringSid(sid, out s); return s;
  }

  /// Whether the folder already grants the container access (a grant this script made).
  public static bool Granted(string dir, string sid) {
    var who = new SecurityIdentifier(sid);
    foreach (FileSystemAccessRule r in new System.IO.DirectoryInfo(dir).GetAccessControl().GetAccessRules(true, false, typeof(SecurityIdentifier)))
      if (r.IdentityReference.Equals(who) && r.AccessControlType == AccessControlType.Allow) return true;
    return false;
  }

  /// Runs a command line inside the container, sharing this process's output, and returns its exit code.
  public static int Run(string name, string commandLine, string dir) {
    IntPtr sid; int hr = DeriveAppContainerSidFromAppContainerName(name, out sid); if (hr != 0) throw new Win32Exception(hr);
    // No capabilities: in particular no internetClient, so no network.
    var caps = new SECURITY_CAPABILITIES { AppContainerSid = sid };
    IntPtr capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(caps)); Marshal.StructureToPtr(caps, capsPtr, false);
    IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr list = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new Win32Exception();
    if (!UpdateProcThreadAttribute(list, 0, (IntPtr)0x00020009 /* SECURITY_CAPABILITIES */, capsPtr, (IntPtr)Marshal.SizeOf(caps), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(si); si.lpAttributeList = list;
    si.StartupInfo.dwFlags = 0x100; // STARTF_USESTDHANDLES: the command writes straight to Buddy
    si.StartupInfo.hStdInput = IntPtr.Zero; si.StartupInfo.hStdOutput = GetStdHandle(-11); si.StartupInfo.hStdError = GetStdHandle(-12);
    PROCESS_INFORMATION pi;
    // The command starts paused, joins a job that ends it when this launcher ends, then runs: stopping the launcher
    // always stops the command, even in the moment it's being started.
    IntPtr job = KillWithMe();
    // EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_SUSPENDED
    if (!CreateProcess(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0x00080000 | 0x08000000 | 0x4, IntPtr.Zero, dir, ref si, out pi)) throw new Win32Exception();
    if (!AssignProcessToJobObject(job, pi.hProcess)) throw new Win32Exception();
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF); // Buddy stops the launcher on timeout or cancel; the job ends the rest
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    return (int)code;
  }
}
'@
# The launcher is named by its source, so one built from a different version of this script is never loaded: the
# shipped one if it matches, else one compiled once into -Cache.
$hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($source))).Replace("-", "").Substring(0, 16)
$prebuilt = if ($Shipped) { Join-Path $Shipped "BuddyWall-$hash.dll" } else { "" }
if ($prebuilt -and (Test-Path -LiteralPath $prebuilt)) {
  Add-Type -Path $prebuilt
} elseif ($Cache) {
  $dll = Join-Path $Cache "BuddyWall-$hash.dll"
  if (-not (Test-Path -LiteralPath $dll)) {
    New-Item -ItemType Directory -Force -Path $Cache | Out-Null
    Add-Type -TypeDefinition $source -OutputAssembly "$dll.tmp" -OutputType Library
    Move-Item -LiteralPath "$dll.tmp" -Destination $dll -Force
  }
  if ($Build) { return }
  Add-Type -Path $dll
} else {
  Add-Type -TypeDefinition $source
}

$dir = [BuddyWall]::LongPath((Resolve-Path -LiteralPath $WorkDir).Path)
$sid = [BuddyWall]::Sid($Name)
if ($Remove) {
  icacls $dir /remove "*$sid" | Out-Null
  [BuddyWall]::DeleteAppContainerProfile($Name) | Out-Null
  return
}
# The working folder (only it) is the container's: change what's in it, never anything above it.
if (-not [BuddyWall]::Granted($dir, $sid)) { icacls $dir /grant "*${sid}:(OI)(CI)(M,DC)" | Out-Null }

$command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Encoded))
$inside = @"
`$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
`$Work = '$($dir.Replace("'", "''"))'
# Inside the wall, PowerShell refuses to move, copy, remove or rename a file named by a path string, but does it for a
# file object. These take the strings, find the files, and hand the objects on, so commands are written as usual.
function __BuddyItems(`$Path, `$LiteralPath) {
  foreach (`$p in @(`$Path) + @(`$LiteralPath)) {
    if (`$null -eq `$p) { continue }
    if (`$p -is [IO.FileSystemInfo]) { `$p }
    elseif (`$LiteralPath -and @(`$LiteralPath) -contains `$p) { Get-Item -LiteralPath `$p -Force }
    else { Get-Item -Path `$p -Force }
  }
}
function __BuddyPass(`$Bound, [string[]]`$Keep) { `$out = @{}; foreach (`$k in `$Keep) { if (`$Bound.ContainsKey(`$k)) { `$out[`$k] = `$Bound[`$k] } }; `$out }
function Move-Item { param([Parameter(Position = 0, ValueFromPipeline = `$true)][object[]]`$Path, [string[]]`$LiteralPath, [Parameter(Position = 1)][string]`$Destination, [switch]`$Force, [switch]`$PassThru, [switch]`$WhatIf)
  process { `$more = __BuddyPass `$PSBoundParameters 'Destination', 'Force', 'PassThru', 'WhatIf'; __BuddyItems `$Path `$LiteralPath | Microsoft.PowerShell.Management\Move-Item @more } }
function Copy-Item { param([Parameter(Position = 0, ValueFromPipeline = `$true)][object[]]`$Path, [string[]]`$LiteralPath, [Parameter(Position = 1)][string]`$Destination, [switch]`$Recurse, [switch]`$Force, [switch]`$PassThru, [switch]`$Container, [switch]`$WhatIf)
  process { `$more = __BuddyPass `$PSBoundParameters 'Destination', 'Recurse', 'Force', 'PassThru', 'Container', 'WhatIf'; __BuddyItems `$Path `$LiteralPath | Microsoft.PowerShell.Management\Copy-Item @more } }
function Remove-Item { param([Parameter(Position = 0, ValueFromPipeline = `$true)][object[]]`$Path, [string[]]`$LiteralPath, [switch]`$Recurse, [switch]`$Force, [switch]`$WhatIf)
  process { `$more = __BuddyPass `$PSBoundParameters 'Recurse', 'Force', 'WhatIf'; __BuddyItems `$Path `$LiteralPath | Microsoft.PowerShell.Management\Remove-Item @more } }
function Rename-Item { param([Parameter(Position = 0, ValueFromPipeline = `$true)][object[]]`$Path, [string[]]`$LiteralPath, [Parameter(Position = 1)][object]`$NewName, [switch]`$Force, [switch]`$PassThru, [switch]`$WhatIf)
  process { foreach (`$item in (__BuddyItems `$Path `$LiteralPath)) { `$name = if (`$NewName -is [scriptblock]) { `$_ = `$item; & `$NewName } else { `$NewName }; `$more = __BuddyPass `$PSBoundParameters 'Force', 'PassThru', 'WhatIf'; `$item | Microsoft.PowerShell.Management\Rename-Item -NewName `$name @more } } }
& {
$command
} 2>&1 | ForEach-Object { if (`$_ -is [System.Management.Automation.ErrorRecord]) { 'Error: ' + `$_.Exception.Message } else { `$_ } } | Out-String -Stream -Width 200
if (`$LASTEXITCODE) { exit `$LASTEXITCODE }
"@
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inside))
# PowerShell keeps its module cache in the container's own storage, the one place outside the working folder a
# container may write, so it isn't rebuilt every time.
$env:PSModuleAnalysisCachePath = Join-Path $env:LOCALAPPDATA "Packages\$($Name.ToLowerInvariant())\AC\ModuleAnalysisCache"
$exe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
exit ([BuddyWall]::Run($Name, "`"$exe`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand $enc", $dir))
