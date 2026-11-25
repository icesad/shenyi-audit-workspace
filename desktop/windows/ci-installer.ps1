[CmdletBinding()]
param([string] $StandardUserStage, [switch] $ShellReady)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-That($Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function Write-Step([string] $Message) {
    [IO.File]::AppendAllText($script:acceptanceLog, ([DateTime]::UtcNow.ToString('u') + ' ' + $Message + [Environment]::NewLine))
}

function Wait-Child($Process, [int] $Seconds, [string] $Stage) {
    $null = $Process.Handle
    if (-not $Process.WaitForExit($Seconds * 1000)) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F | Out-Null
        throw "$Stage exceeded $Seconds seconds."
    }
    Assert-That ($Process.ExitCode -eq 0) "$Stage exited $($Process.ExitCode)."
}

function Invoke-Setup([string] $Exe) {
    Write-Step "Running $Exe /S"
    $process = Start-Process -FilePath $Exe -ArgumentList '/S' -WindowStyle Hidden -PassThru
    Wait-Child $process 100 $Exe
}

function Wait-For([scriptblock] $Check, [string] $Message) {
    $until = [DateTime]::UtcNow.AddSeconds(40)
    while (-not (& $Check)) {
        if ([DateTime]::UtcNow -gt $until) { throw $Message }
        Start-Sleep -Milliseconds 250
    }
}

function Get-Install($Build) {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ShenyiWorkbenchPreview-' + $Build.Id
    $folder = Join-Path $env:LOCALAPPDATA ('Programs\ShenyiWorkbenchPreview\' + $Build.Id)
    return @{ Key=$key; Folder=$folder; Exe=(Join-Path $folder 'ShenyiWorkbench.exe'); Uninstall=(Join-Path $folder 'Uninstall.exe') }
}

function Assert-Installed($Build, $Installed) {
    Write-Step "Checking registered version $($Build.Version), install location and executables."
    $record = Get-ItemProperty -LiteralPath $Installed.Key
    Assert-That ($record.DisplayVersion -eq $Build.Version) 'Incorrect registered release version.'
    Assert-That ($record.InstallLocation.TrimEnd('\') -eq $Installed.Folder) 'Unexpected per-user install folder.'
    Assert-That (Test-Path -LiteralPath $Installed.Exe -PathType Leaf) 'Missing installed client.'
    Assert-That (Test-Path -LiteralPath $Installed.Uninstall -PathType Leaf) 'Missing registered uninstaller.'
}

function Get-FileIdentity([string] $Path) {
    if (-not ('WorkbenchAcceptance.FileId' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace WorkbenchAcceptance {
    public static class FileId {
        [StructLayout(LayoutKind.Sequential)]
        private struct IdInfo { public ulong Volume, Low, High; }
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int infoClass, out IdInfo info, uint size);
        public static string Read(string name) {
            using (var file = File.Open(name, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
                IdInfo id;
                if (!GetFileInformationByHandleEx(file.SafeFileHandle, 18, out id, (uint)Marshal.SizeOf(typeof(IdInfo))))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return String.Format("{0:X16}:{1:X16}{2:X16}", id.Volume, id.High, id.Low);
            }
        }
    }
}
'@
    }
    return [WorkbenchAcceptance.FileId]::Read($Path)
}

function Write-ProfileShortcuts([string] $Root, $Shell) {
    Write-Step "Searching the disposable profile (including hidden links): $Root"
    $dirs = [Collections.Generic.Stack[string]]::new()
    $dirs.Push($Root)
    $count = 0
    while ($dirs.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $dirs.Pop() -Force -ErrorAction SilentlyContinue) {
            if ($item.PSIsContainer) {
                if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $dirs.Push($item.FullName) }
            } elseif ($item.Extension -eq '.lnk') {
                $count++
                try { $value = $Shell.CreateShortcut($item.FullName).TargetPath } catch { $value = $_.Exception.Message }
                Write-Step "Found $($item.FullName) [$($item.Attributes)] -> '$value'"
            }
        }
    }
    Write-Step "Found $count shortcuts in $Root."
}

function Get-StartShortcut([string] $Target, [string] $BuildId='') {
    $programs = [Environment]::GetFolderPath('Programs')
    $title = '审易工作台（内测）'
    $expected = if ($BuildId) {
        Join-Path $programs "审易工作台内测版本\$title $BuildId.lnk"
    } else {
        Join-Path $programs ($title + '.lnk')
    }
    $shell = New-Object -ComObject WScript.Shell
    Write-Step "Looking for exact Start menu link '$expected' -> '$Target'."
    try {
        Assert-That ([IO.File]::Exists($expected)) "Expected Start menu shortcut does not exist: $expected"
        $link = $shell.CreateShortcut($expected)
        $resolved = [Environment]::ExpandEnvironmentVariables($link.TargetPath)
        Write-Step "Actual shortcut '$expected' -> '$resolved', arguments '$($link.Arguments)'."
        Assert-That ([string]::IsNullOrEmpty($link.Arguments)) 'Unexpected shortcut arguments.'
        Assert-That ([IO.Path]::IsPathRooted($resolved) -and [IO.File]::Exists($resolved)) "Shortcut target is not an existing local file: '$resolved'"
        $actualId = Get-FileIdentity $resolved
        $expectedId = Get-FileIdentity $Target
        Assert-That ($actualId -eq $expectedId) "Wrong shortcut target: $resolved ($actualId), expected $Target ($expectedId)."
        return $expected
    } catch {
        Write-ProfileShortcuts $env:USERPROFILE $shell
        throw
    }
}

function Test-Workspace($Share, $Installed, $Build, [string] $Mode, [string] $WorkspacePath) {
    $clientProbe = Join-Path $Share 'ci-installed-workspace.cjs'
    $arguments = @($clientProbe, $Installed.Exe, $Mode, $Build.Version, $WorkspacePath) | ForEach-Object { '"' + $_ + '"' }
    $stage = "$Mode $($Build.Version) in $WorkspacePath"
    Write-Step "Opening installed client for $stage"
    $probe = Start-Process -FilePath (Join-Path $Share 'node.exe') -ArgumentList $arguments -WorkingDirectory $Share -WindowStyle Hidden -PassThru
    Wait-Child $probe 105 $stage
}

function Initialize-UserShell([string] $Sid, [string] $Root) {
    # Prove HKCU points to this token's loaded hive before configuring any known folders.
    $check = 'Software\ShenyiCiHive-' + [Guid]::NewGuid().ToString('N')
    $hive = [Microsoft.Win32.Registry]::Users.OpenSubKey($Sid, $true)
    Assert-That ($null -ne $hive) "No loaded registry hive for $Sid."
    try {
        $proof = $hive.CreateSubKey($check)
        try { $proof.SetValue('Owner', $Sid) } finally { $proof.Dispose() }
        $same = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($check)
        Assert-That ($null -ne $same) 'HKCU does not resolve to the disposable account hive.'
        try { Assert-That ($same.GetValue('Owner') -eq $Sid) 'Incorrect HKCU owner.' } finally { $same.Dispose() }
    } finally {
        $hive.DeleteSubKey($check, $false)
        $hive.Dispose()
    }

    # A secondary logon loads NTUSER.DAT without Explorer's first interactive sign-in.
    # Populate the standard user folder registrations for this new profile only.
    $menu = 'AppData\Roaming\Microsoft\Windows\Start Menu'
    $relativeFolders = [ordered]@{
        'AppData'='AppData\Roaming'; 'Local AppData'='AppData\Local'; 'Start Menu'=$menu
        'Programs'=($menu + '\Programs'); 'Personal'='Documents'; 'Desktop'='Desktop'
    }
    $explorer = 'Software\Microsoft\Windows\CurrentVersion\Explorer\'
    $expandable = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($explorer + 'User Shell Folders')
    $resolved = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($explorer + 'Shell Folders')
    try {
        foreach ($name in $relativeFolders.Keys) {
            $relative = $relativeFolders[$name]
            $full = Join-Path $Root $relative
            [void][IO.Directory]::CreateDirectory($full)
            $expandable.SetValue($name, ('%USERPROFILE%\' + $relative), [Microsoft.Win32.RegistryValueKind]::ExpandString)
            $resolved.SetValue($name, $full, [Microsoft.Win32.RegistryValueKind]::String)
        }
    } finally {
        $expandable.Dispose()
        $resolved.Dispose()
    }
}

function Test-AsStandardUser([string] $Share) {
    $plan = Get-Content -Raw -LiteralPath (Join-Path $Share 'plan.json') | ConvertFrom-Json
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    Write-Step "Worker started as $($identity.Name), SID $($identity.User.Value), session $([Diagnostics.Process]::GetCurrentProcess().SessionId)."
    Assert-That ($identity.User.Value -eq $plan.Sid) 'Unexpected acceptance account.'
    Assert-That ($identity.Name.Split('\')[-1] -match '^ShenyiCI[0-9a-f]{8}$') 'Worker requires the disposable CI account.'
    Assert-That (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'Installer test must use a non-administrator token.'
    $registered = Get-ItemPropertyValue -LiteralPath ('HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $plan.Sid) -Name ProfileImagePath
    $root = [Environment]::ExpandEnvironmentVariables($registered)
    Assert-That ($root -match '^[a-z]:\\.+' -and (Test-Path -LiteralPath $root -PathType Container)) 'SID lacks a valid local profile directory.'
    Assert-That ($root -eq [Environment]::GetFolderPath('UserProfile')) 'Loaded profile does not belong to the CI user.'
    $env:USERPROFILE = $root
    $env:USERNAME = $identity.Name.Split('\')[1]
    $env:USERDOMAIN = $identity.Name.Split('\')[0]
    $env:HOMEDRIVE = [IO.Path]::GetPathRoot($root).TrimEnd('\')
    $env:HOMEPATH = $root.Substring($env:HOMEDRIVE.Length)
    $env:APPDATA = Join-Path $root 'AppData\Roaming'
    $env:LOCALAPPDATA = Join-Path $root 'AppData\Local'
    $env:TEMP = Join-Path $env:LOCALAPPDATA 'Temp'
    $env:TMP = $env:TEMP
    if (-not $ShellReady) {
        Write-Step "Initializing Windows shell folders in the verified standard-user profile $root."
        Initialize-UserShell $plan.Sid $root
        [void][IO.Directory]::CreateDirectory($env:TEMP)
        # Start a fresh process so Shell32 resolves the new registrations with this user's environment.
        $nativePowerShell = Join-Path $PSHOME 'powershell.exe'
        $argsForShell = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + $PSCommandPath + '" -StandardUserStage "' + $Share + '" -ShellReady'
        $ready = Start-Process -FilePath $nativePowerShell -ArgumentList $argsForShell -WorkingDirectory $Share -WindowStyle Hidden -PassThru
        Wait-Child $ready 480 'Initialized standard-user acceptance'
        return
    }
    $expectedPrograms = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    foreach ($entry in @{ApplicationData=$env:APPDATA; LocalApplicationData=$env:LOCALAPPDATA; Programs=$expectedPrograms}.GetEnumerator()) {
        $actual = [Environment]::GetFolderPath($entry.Key)
        Assert-That ($actual -eq $entry.Value) "Windows shell folder $($entry.Key) resolved to '$actual', expected '$($entry.Value)'."
    }
    $workspacePath = Join-Path $env:APPDATA 'Shenyi-Workbench-LocalReview'
    Write-Step "Confirmed standard token and profile $workspacePath"
    Assert-That (-not (Test-Path -LiteralPath $workspacePath)) 'Standard user profile was not fresh.'
    $old = Get-Install $plan.Old
    $new = Get-Install $plan.New
    Assert-That ($old.Folder -ne $new.Folder) 'Expected two distinct versioned installation directories.'
    Invoke-Setup (Join-Path $Share 'old-setup.exe')
    Assert-Installed $plan.Old $old
    $link = Get-StartShortcut $old.Exe
    $oldVersionLink = Get-StartShortcut $old.Exe $plan.Old.Id
    Test-Workspace $Share $old $plan.Old 'seed' $workspacePath
    Invoke-Setup (Join-Path $Share 'new-setup.exe')
    Assert-Installed $plan.New $new
    Assert-That ((Get-StartShortcut $new.Exe) -eq $link) 'Upgrade did not retarget the existing shortcut.'
    $newVersionLink = Get-StartShortcut $new.Exe $plan.New.Id
    Test-Workspace $Share $new $plan.New 'read' $workspacePath
    Invoke-Setup $old.Uninstall
    Wait-For { -not (Test-Path -LiteralPath $old.Folder) -and -not (Test-Path -LiteralPath $old.Key) } 'Old release was not removed.'
    Assert-That (-not (Test-Path -LiteralPath $oldVersionLink)) 'Removed release left its version shortcut.'
    Assert-That ((Get-StartShortcut $new.Exe) -eq $link) 'Removing an inactive release removed the current shortcut.'
    Invoke-Setup $new.Uninstall
    Wait-For { -not (Test-Path -LiteralPath $new.Folder) -and -not (Test-Path -LiteralPath $new.Key) -and -not (Test-Path -LiteralPath $link) } 'Active release, uninstall key or shortcut remains.'
    Assert-That (-not (Test-Path -LiteralPath $newVersionLink)) 'Removed release left its version shortcut.'
    Assert-That (Test-Path -LiteralPath $workspacePath -PathType Container) 'Uninstall deleted the local workspace.'
    Invoke-Setup (Join-Path $Share 'new-setup.exe')
    Assert-Installed $plan.New $new
    Test-Workspace $Share $new $plan.New 'read' $workspacePath
    Invoke-Setup $new.Uninstall
    Wait-For { -not (Test-Path -LiteralPath $new.Folder) -and -not (Test-Path -LiteralPath $new.Key) -and -not (Test-Path -LiteralPath $link) } 'Reinstalled release cleanup was incomplete.'
    Write-Step "Passed standard-user silent install, Start menu, native launch, upgrade $($plan.Old.Version) -> $($plan.New.Version), old/new uninstall and workspace recovery."
}

if ($StandardUserStage) {
    $script:acceptanceLog = Join-Path $StandardUserStage 'results\acceptance.txt'
    $env:SHENYI_INSTALL_ACCEPTANCE_LOG = $script:acceptanceLog
    try { Test-AsStandardUser $StandardUserStage; exit 0 }
    catch { Write-Step ("FAIL " + $_.Exception.Message + [Environment]::NewLine + $_.ScriptStackTrace); exit 1 }
}

Assert-That ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:RUNNER_OS -eq 'Windows') 'Run on a disposable GitHub-hosted Windows runner.'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repo
$work = Join-Path $env:RUNNER_TEMP ('workbench-' + [Guid]::NewGuid().ToString('N'))
$share = Join-Path $env:PUBLIC ('ShenyiCi-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work)
[void](New-Item -ItemType Directory -Path $share)
function Get-Archive([string] $Url, [string] $Name, [string] $Sha256) {
    $out = Join-Path $work $Name
    & curl.exe --fail --location --retry 3 --max-time 300 --silent --show-error --output $out $Url
    Assert-That ($LASTEXITCODE -eq 0 -and (Get-FileHash -LiteralPath $out).Hash -eq $Sha256) "Archive download or pinned digest failed: $Name"
    return $out
}
$electron = Get-Archive 'https://github.com/electron/electron/releases/download/v45.3.2/electron-v45.3.2-win32-x64.zip' 'electron.zip' 'cd1ab0d49c2f76838c0c9ff75afefb4d9d85ca59036691932bf35be8eceba98b'
$nsis = Get-Archive 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip' 'nsis.zip' 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8'

function New-Build([string] $Name, [string] $Version) {
    $out = Join-Path $share ($Name + '-setup.exe')
    $lines = @(& node desktop/windows/installer/build.mjs $electron $nsis $out)
    Assert-That ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $out)) 'Installer build failed.'
    $receipt = $lines[-1] | ConvertFrom-Json
    Assert-That ($receipt.version -eq $Version -and $receipt.buildId -match '^\d+\.\d+\.\d+-[0-9a-f]{16}$') 'Unexpected installer build receipt.'
    Write-Host "Built $($receipt.buildId) ($($receipt.files) files) SHA256 $($receipt.sha256)"
    return @{Id=$receipt.buildId; Version=$Version}
}

$manifest = Join-Path $repo 'desktop\windows\package.json'
$original = [IO.File]::ReadAllBytes($manifest)
$pkg = [Text.Encoding]::UTF8.GetString($original) | ConvertFrom-Json
$old = New-Build 'old' $pkg.version
try {
    # The disposable CI checkout gets a distinct build version for an upgrade of the same business source.
    $v = [version]$pkg.version
    $pkg.version = '{0}.{1}.{2}' -f $v.Major,$v.Minor,($v.Build + 1)
    [IO.File]::WriteAllText($manifest, ($pkg | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $new = New-Build 'new' $pkg.version
} finally { [IO.File]::WriteAllBytes($manifest, $original) }

Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $share 'node.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ci-installed-workspace.cjs') -Destination $share
Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $share 'ci-installer.ps1')
$modules = New-Item -ItemType Directory -Path (Join-Path $share 'node_modules')
foreach ($name in @('playwright','playwright-core')) {
    Copy-Item -LiteralPath (Join-Path $repo ('node_modules\' + $name)) -Destination $modules.FullName -Recurse
}
$results = New-Item -ItemType Directory -Path (Join-Path $share 'results')
$login = 'ShenyiCI' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$password = ConvertTo-SecureString ('T!4_' + [Guid]::NewGuid().ToString('N')) -AsPlainText -Force
$user = New-LocalUser -Name $login -Password $password -Description 'Disposable unpackaged installer acceptance'
try {
    $users = Get-LocalGroup -SID 'S-1-5-32-545'
    if ($user.SID.Value -notin @(Get-LocalGroupMember -Group $users | ForEach-Object { $_.SID.Value })) {
        Add-LocalGroupMember -Group $users -Member $user
    }
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($user.SID,'ReadAndExecute','ContainerInherit, ObjectInherit','None','Allow')
    $acl = Get-Acl -LiteralPath $share
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $share -AclObject $acl
    $writable = Get-Acl -LiteralPath $results.FullName
    $writable.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user.SID,'Modify','ContainerInherit, ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $results.FullName -AclObject $writable
    @{Sid=$user.SID.Value; Old=$old; New=$new} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $share 'plan.json') -Encoding Ascii
    $credential = [PSCredential]::new(($env:COMPUTERNAME + '\' + $login),$password)
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $argsForTest = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + (Join-Path $share 'ci-installer.ps1') + '" -StandardUserStage "' + $share + '"'
    $secondaryLogon = Get-Service -Name seclogon
    if ($secondaryLogon.StartType -eq [System.ServiceProcess.ServiceStartMode]::Disabled) {
        Set-Service -Name seclogon -StartupType Manual
    }
    Start-Service -Name seclogon
    $log = Join-Path $results.FullName 'acceptance.txt'
    Write-Host "Starting worker with a loaded profile for $login. Progress log: $log"
    $worker = Start-Process -FilePath $powershell -Credential $credential -LoadUserProfile -WorkingDirectory $share -ArgumentList $argsForTest -WindowStyle Hidden -PassThru
    $null = $worker.Handle
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $seen = 0
    try {
        do {
            $exited = $worker.WaitForExit(1000)
            if (Test-Path -LiteralPath $log) {
                $lines = @(Get-Content -LiteralPath $log -Encoding UTF8)
                while ($seen -lt $lines.Count) { Write-Host $lines[$seen]; $seen++ }
            }
            if ($timer.Elapsed.TotalSeconds -gt 50 -and $seen -eq 0) { throw "Worker $($worker.Id) did not reach its first stage. Log: $log" }
            if ($timer.Elapsed.TotalMinutes -ge 9) { throw "Worker $($worker.Id) timed out. See the last recorded stage in $log" }
        } until ($exited)
        Assert-That ($worker.ExitCode -eq 0) "Worker $($worker.Id) exited $($worker.ExitCode). Log: $log"
        Assert-That ($seen -gt 0 -and @($lines -match ' Passed standard-user silent install,').Count -eq 1) "Worker did not complete the full acceptance. Log: $log"
    } finally {
        if (-not $worker.HasExited) { $worker.Kill($true); $null = $worker.WaitForExit(5000) }
    }
} finally {
    Remove-LocalUser -SID $user.SID
    $password.Dispose()
}
