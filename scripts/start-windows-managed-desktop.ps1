[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$InstallationRoot,
    [Parameter(Mandatory = $true)][string]$PublicKey,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$PublisherSha256,
    [Parameter(Mandatory = $true)][string]$ServiceConfig,
    [string]$ShortcutPath,
    [switch]$FromShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'

function Get-LocalPath([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:[\\/]' -or $Value.Substring(2) -match '[:"\x00-\x1f\x7f]') {
        throw 'Expected an absolute local Windows path.'
    }
    return [IO.Path]::GetFullPath($Value).TrimEnd([char[]]'\\/')
}

function Get-RegularPath([string]$Value, [bool]$Directory = $false) {
    $full = Get-LocalPath $Value
    if ($full.Length -le 2) { throw 'Use a dedicated path below the drive root.' }
    $entry = Get-Item -LiteralPath $full -Force
    if ($entry.PSIsContainer -ne $Directory) { throw 'A required launch file or directory has the wrong type.' }
    $current = $entry
    while ($null -ne $current) {
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Launcher paths cannot use reparse points.'
        }
        $parent = [IO.Path]::GetDirectoryName($current.FullName)
        $current = if ($parent) { Get-Item -LiteralPath $parent -Force } else { $null }
    }
    return $entry.FullName
}

function Join-Arguments([string[]]$Items) {
    # All variable items are validated local paths without quotes and with no trailing separator.
    return (($Items | ForEach-Object { '"' + $_ + '"' }) -join ' ')
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitProcess) {
        throw 'Use 64-bit Windows PowerShell.'
    }
    Import-Module ([IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1'))
    Import-Module ([IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'))
    if ($ShortcutPath -and $FromShortcut) { throw 'Choose shortcut creation or launch.' }
    $entry = Get-RegularPath $PSCommandPath
    $cli = Get-RegularPath (Join-Path $PSScriptRoot 'manage-windows-candidate-install.mjs')
    $node = Get-RegularPath $NodePath
    if ([IO.Path]::GetFileName($node) -ine 'node.exe') { throw 'Choose the trusted node.exe.' }
    $root = Get-RegularPath $InstallationRoot $true
    $key = Get-RegularPath $PublicKey
    $config = Get-RegularPath $ServiceConfig
    $pin = $PublisherSha256.ToLowerInvariant()

    if ($ShortcutPath) {
        $output = Get-LocalPath $ShortcutPath
        if ([IO.Path]::GetExtension($output) -ine '.lnk' -or (Test-Path -LiteralPath $output)) {
            throw 'Choose a new .lnk file. Existing files are kept.'
        }
        $destination = Get-RegularPath ([IO.Path]::GetDirectoryName($output)) $true
        $stage = Join-Path $destination ('.shenyi-' + [guid]::NewGuid().ToString('N') + '.lnk')
        $shell = $null
        $link = $null
        $stored = $null
        try {
            $shell = New-Object -ComObject WScript.Shell
            $link = $shell.CreateShortcut($stage)
            $target = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
            $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File ' + (Join-Arguments @(
                $entry, '-NodePath', $node, '-InstallationRoot', $root, '-PublicKey', $key,
                '-PublisherSha256', $pin, '-ServiceConfig', $config, '-FromShortcut'
            ))
            $workingDirectory = [IO.Path]::GetDirectoryName($entry)
            $link.TargetPath = $target
            $link.Arguments = $arguments
            $link.WorkingDirectory = $workingDirectory
            $link.Description = 'Shenyi managed desktop'
            $link.Save()
            $stored = $shell.CreateShortcut($stage)
            if ($stored.TargetPath -ine $target -or $stored.Arguments -cne $arguments -or $stored.WorkingDirectory -ine $workingDirectory) {
                throw 'Windows did not preserve the managed shortcut target and arguments.'
            }
            [IO.File]::Move($stage, $output)
        }
        finally {
            if ($null -ne $stored) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($stored) }
            if ($null -ne $link) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
            if ($null -ne $shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
            if ([IO.File]::Exists($stage)) { [IO.File]::Delete($stage) }
        }
        [ordered]@{ ok = $true; shortcut = $output; applicationLaunched = $false } | ConvertTo-Json -Compress
        exit 0
    }

    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $node
    $start.WorkingDirectory = [IO.Path]::GetDirectoryName($cli)
    $start.Arguments = Join-Arguments @($cli, 'launch', '--root', $root, '--public-key', $key, '--publisher-sha256', $pin, '--service-config', $config)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($name in @($start.EnvironmentVariables.Keys)) {
        if ($name -match '^(NODE_|ELECTRON_|SHENYI_|OPENSSL_|SSL_CERT_(FILE|DIR)$|(HTTPS?|ALL|NO|GLOBAL_AGENT_HTTP)_PROXY$|VSCODE_(INSPECTOR_OPTIONS|JS_DEBUG_OPTIONS)$)') {
            $start.EnvironmentVariables.Remove($name)
        }
    }
    $start.EnvironmentVariables['Path'] = [Environment]::SystemDirectory + ';' + [IO.Directory]::GetParent([Environment]::SystemDirectory).FullName
    $process = [Diagnostics.Process]::Start($start)
    try {
        $out = $process.StandardOutput.ReadToEndAsync()
        $err = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw $err.GetAwaiter().GetResult().Trim() }
        $response = $out.GetAwaiter().GetResult().Trim()
        $receipt = ConvertFrom-Json -InputObject $response
        if ($receipt.ok -ne $true -or $receipt.operation -cne 'launch' -or $receipt.osSignatureVerified -ne $true -or
            $receipt.publisherCertificateSha256 -cne $pin -or [long]$receipt.pid -le 0) {
            throw 'The launcher did not confirm a dual-signed desktop process.'
        }
        $response
    }
    finally { $process.Dispose() }
}
catch {
    if ($FromShortcut) {
        Add-Type -AssemblyName System.Windows.Forms
        $message = 'Shenyi could not verify and start the desktop application. Please contact your administrator.'
        [void][Windows.Forms.MessageBox]::Show($message, 'Shenyi', 'OK', 'Error')
    }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
