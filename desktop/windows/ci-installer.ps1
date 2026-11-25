[CmdletBinding()]
param([string] $StandardUserStage)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-That($Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-Setup([string] $Exe) {
    $process = Start-Process -FilePath $Exe -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    Assert-That ($process.ExitCode -eq 0) "Installer exited $($process.ExitCode): $Exe"
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
    $folder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('Programs\ShenyiWorkbenchPreview\' + $Build.Id)
    return @{ Key=$key; Folder=$folder; Exe=(Join-Path $folder 'ShenyiWorkbench.exe'); Uninstall=(Join-Path $folder 'Uninstall.exe') }
}

function Assert-Installed($Build, $Installed) {
    $record = Get-ItemProperty -LiteralPath $Installed.Key
    Assert-That ($record.DisplayVersion -eq $Build.Version) 'Incorrect registered release version.'
    Assert-That ($record.InstallLocation.TrimEnd('\') -eq $Installed.Folder) 'Unexpected per-user install folder.'
    Assert-That (Test-Path -LiteralPath $Installed.Exe -PathType Leaf) 'Missing installed client.'
    Assert-That (Test-Path -LiteralPath $Installed.Uninstall -PathType Leaf) 'Missing registered uninstaller.'
}

function Get-StartShortcut([string] $Target, [string] $BuildId='') {
    $programs = [Environment]::GetFolderPath('Programs')
    $shell = New-Object -ComObject WScript.Shell
    $links = Get-ChildItem -LiteralPath $programs -File -Filter '*.lnk' -Recurse:([bool]$BuildId)
    foreach ($entry in $links) {
        if ($BuildId -and -not $entry.BaseName.EndsWith($BuildId)) { continue }
        $lnk = $shell.CreateShortcut($entry.FullName)
        if ($lnk.TargetPath -eq $Target) { return $entry.FullName }
    }
    throw "Missing per-user Start menu shortcut for $Target"
}

function Test-Workspace($Share, $Installed, $Build, [string] $Mode, [string] $WorkspacePath) {
    $clientProbe = Join-Path $Share 'ci-installed-workspace.cjs'
    & (Join-Path $Share 'node.exe') $clientProbe $Installed.Exe $Mode $Build.Version $WorkspacePath
    if ($LASTEXITCODE -ne 0) { throw "Installed application workspace check failed: $Mode $($Build.Version)" }
}

function Test-AsStandardUser([string] $Share) {
    $plan = Get-Content -Raw -LiteralPath (Join-Path $Share 'plan.json') | ConvertFrom-Json
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    Assert-That ($identity.User.Value -eq $plan.Sid) 'Unexpected acceptance account.'
    Assert-That ($identity.Name.Split('\')[-1] -match '^ShenyiCI[0-9a-f]{8}$') 'Worker requires the disposable CI account.'
    Assert-That (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'Installer test must use a non-administrator token.'
    $env:USERPROFILE = [Environment]::GetFolderPath('UserProfile')
    $env:APPDATA = [Environment]::GetFolderPath('ApplicationData')
    $env:LOCALAPPDATA = [Environment]::GetFolderPath('LocalApplicationData')
    $env:TEMP = Join-Path $env:LOCALAPPDATA 'Temp'
    $env:TMP = $env:TEMP
    [IO.Directory]::CreateDirectory($env:TEMP) | Out-Null
    $workspacePath = Join-Path $env:APPDATA 'Shenyi-Workbench-LocalReview'
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
    Write-Output "Passed standard-user silent install, Start menu, native launch, upgrade $($plan.Old.Version) -> $($plan.New.Version), old/new uninstall and workspace recovery."
}

if ($StandardUserStage) {
    $log = Join-Path $StandardUserStage 'results\acceptance.txt'
    try { Test-AsStandardUser $StandardUserStage *> $log; exit 0 }
    catch { Add-Content -LiteralPath $log -Value ($_ | Out-String); exit 1 }
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
    $task = New-ScheduledTaskAction -Execute $powershell -Argument $argsForTest -WorkingDirectory $share
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $login -Action $task -Settings $settings -User $credential.UserName -Password $credential.GetNetworkCredential().Password -RunLevel Limited | Out-Null
    try {
        Start-ScheduledTask -TaskName $login
        $until = [DateTime]::UtcNow.AddMinutes(11)
        do {
            Start-Sleep -Seconds 2
            $info = Get-ScheduledTaskInfo -TaskName $login
            if ([DateTime]::UtcNow -gt $until) { throw 'Standard-user acceptance timed out.' }
        } while ($info.LastRunTime.Year -lt 2000 -or (Get-ScheduledTask -TaskName $login).State -in @('Running','Queued'))
    } finally {
        Unregister-ScheduledTask -TaskName $login -Confirm:$false
    }
    $log = Join-Path $results.FullName 'acceptance.txt'
    $lines = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log }
    $lines | Write-Output
    Assert-That ($info.LastTaskResult -eq 0 -and @($lines -like 'Passed standard-user silent install,*').Count -eq 1) "Standard-user installer acceptance failed ($($info.LastTaskResult))."
} finally {
    Remove-LocalUser -SID $user.SID
    $password.Dispose()
}
