[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RequestPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Data-only transport author. It never invokes msiexec or installs/registers a product.
# Native schema/sequence references:
# https://learn.microsoft.com/windows/win32/msi/directory-table
# https://learn.microsoft.com/windows/win32/msi/featurecomponents-table
# https://learn.microsoft.com/windows/win32/msi/suggested-adminexecutesequence
# https://learn.microsoft.com/windows/win32/msi/-streams-table

function Local-Path([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:[\\/]' -or $Value.Substring(2) -match '[:\x00-\x1f\x7f]') { throw 'A local absolute path is required.' }
    $full = [IO.Path]::GetFullPath($Value)
    $current = $full
    while ($current -and $current -ne [IO.Path]::GetPathRoot($current)) {
        $entry = Get-Item -LiteralPath $current -Force
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not allowed.' }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    return $full
}

function Hex-Hash([string]$Value) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Named-Guid([string]$Value) {
    # MSI identifiers, deterministically scoped to this product version and resource.
    $hex = Hex-Hash ('shenyi.release-source-msi.v1|' + $Value)
    return ('{' + $hex.Substring(0, 8) + '-' + $hex.Substring(8, 4) + '-' + $hex.Substring(12, 4) + '-' + $hex.Substring(16, 4) + '-' + $hex.Substring(20, 12) + '}').ToUpperInvariant()
}

function Write-Idt([string]$Name, [string[]]$Columns, [string[]]$Types, [string[]]$Keys, [object[]]$Rows) {
    if ($Rows.Count -gt 0 -and $Rows[0] -isnot [array]) { $Rows = ,@($Rows) }
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add(($Columns -join "`t"))
    $lines.Add(($Types -join "`t"))
    $lines.Add((@($Name) + $Keys -join "`t"))
    foreach ($row in $Rows) {
        if ($row.Count -ne $Columns.Count) { throw ('Invalid authored row: ' + $Name) }
        $values = @($row | ForEach-Object {
            if ($null -eq $_) { '' } else {
                $text = [string]$_
                if ($text -match '[\x00-\x1f\x7f-\xff]' -or $text -match '[^\x20-\x7e]') { throw 'IDT fields must be printable ASCII.' }
                $text
            }
        })
        $lines.Add(($values -join "`t"))
    }
    [IO.File]::WriteAllText((Join-Path $script:authorDirectory ($Name + '.idt')), (($lines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
    $script:database.Import([string]$script:authorDirectory, [string]($Name + '.idt'))
}

function Release-Com($Value) {
    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) }
}

if (-not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Use 64-bit PowerShell on Windows.' }
$requestFile = Local-Path $RequestPath
if ((Get-Item -LiteralPath $requestFile).PSIsContainer -or (Get-Item -LiteralPath $requestFile).Length -gt 8MB) { throw 'Invalid MSI author request.' }
$request = [IO.File]::ReadAllText($requestFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ((@($request.PSObject.Properties.Name | Sort-Object) -join ',') -ne 'files,outputDirectory,payloadDirectory,version') { throw 'Unexpected MSI request fields.' }
$version = [string]$request.version
if ($version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'A canonical three-part MSI version is required.' }
$versionParts = $version.Split('.')
if ([decimal]$versionParts[0] -gt 255 -or [decimal]$versionParts[1] -gt 255 -or [decimal]$versionParts[2] -gt 65535) { throw 'The version exceeds Windows Installer limits.' }
$outputDirectory = Local-Path ([string]$request.outputDirectory)
$payloadDirectory = Local-Path ([string]$request.payloadDirectory)
if (-not (Get-Item -LiteralPath $outputDirectory).PSIsContainer -or -not (Get-Item -LiteralPath $payloadDirectory).PSIsContainer -or
    -not [string]::Equals([IO.Path]::GetDirectoryName($outputDirectory), [IO.Path]::GetDirectoryName($payloadDirectory), [StringComparison]::OrdinalIgnoreCase) -or
    [string]::Equals($outputDirectory, $payloadDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    -not [string]::Equals([IO.Path]::GetDirectoryName($requestFile), [IO.Path]::GetDirectoryName($outputDirectory), [StringComparison]::OrdinalIgnoreCase) -or
    @(Get-ChildItem -LiteralPath $outputDirectory -Force).Count -ne 0) { throw 'Use an empty output directory and a sibling private payload directory.' }
if ([IO.Path]::GetFileName($payloadDirectory) -notmatch '^[A-Za-z0-9_-]+$') { throw 'The private payload directory needs a simple ASCII name.' }

$declared = New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
$aliases = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$totalBytes = [long]0
foreach ($file in @($request.files)) {
    if ((@($file.PSObject.Properties.Name | Sort-Object) -join ',') -ne 'bytes,relativePath') { throw 'Unexpected file request fields.' }
    $relative = [string]$file.relativePath
    if ($relative.Length -gt 240 -or $relative -notmatch '^(?:[A-Za-z0-9_@+\-][A-Za-z0-9._@+\-]*/)*[A-Za-z0-9_@+\-][A-Za-z0-9._@+\-]*$' -or
        ($relative -ne 'signature.ed25519' -and -not $relative.StartsWith('bundle/', [StringComparison]::Ordinal))) { throw 'Invalid payload relative path.' }
    foreach ($segment in $relative.Split('/')) {
        if ($segment.Length -gt 120 -or $segment.EndsWith('.') -or $segment -match '^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)') { throw 'Invalid Windows payload name.' }
    }
    if (-not $aliases.Add($relative) -or $declared.ContainsKey($relative)) { throw 'Duplicate or case-aliased payload file.' }
    if ($null -eq $file.bytes -or [decimal]$file.bytes -lt 0 -or [decimal]$file.bytes -gt [int]::MaxValue -or [decimal]$file.bytes -ne [decimal][long]$file.bytes) { throw 'Invalid MSI file size.' }
    $length = [long]$file.bytes
    $declared.Add($relative, $length)
    $totalBytes += $length
}
if ($declared.Count -lt 3 -or $declared.Count -gt 32767 -or $totalBytes -gt [int]::MaxValue -or
    -not $declared.ContainsKey('signature.ed25519') -or -not $declared.ContainsKey('bundle/candidate-manifest.json') -or -not $declared.ContainsKey('bundle/Shenyi.exe')) { throw 'Invalid release-source payload inventory.' }
$actual = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
$expectedDirectories = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
foreach ($name in $declared.Keys) {
    $slash = $name.LastIndexOf('/')
    while ($slash -ge 0) { [void]$expectedDirectories.Add($name.Substring(0, $slash)); $slash = $name.LastIndexOf('/', $slash - 1) }
}
function Inspect-Payload([string]$Directory, [string]$Prefix) {
    foreach ($entry in @(Get-ChildItem -LiteralPath $Directory -Force)) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Payload links are not allowed.' }
        $name = $Prefix + $entry.Name
        if ($entry.PSIsContainer) {
            if (-not $expectedDirectories.Contains($name)) { throw 'Unexpected payload directory.' }
            Inspect-Payload $entry.FullName ($name + '/')
        }
        else {
            if (-not $declared.ContainsKey($name) -or $entry.Length -ne $declared[$name] -or -not $actual.Add($name)) { throw 'Payload inventory differs from the request.' }
        }
    }
}
Inspect-Payload $payloadDirectory ''
if ($actual.Count -ne $declared.Count) { throw 'Payload files are missing.' }

$script:authorDirectory = Join-Path $outputDirectory '_msi-author'
[void][IO.Directory]::CreateDirectory($script:authorDirectory)
$msiPath = Join-Path $outputDirectory 'shenyi-release.msi'
$script:database = $null
$installer = $null
$view = $null
$record = $null
try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $script:database = $installer.OpenDatabase([string]$msiPath, [int]3)
    $productCode = Named-Guid ('product|' + $version)
    $packageCode = '{' + [guid]::NewGuid().ToString().ToUpperInvariant() + '}'
    Write-Idt 'Property' @('Property', 'Value') @('s72', 'l0') @('Property') @(
        @('ProductCode', $productCode), @('ProductLanguage', '1033'), @('ProductVersion', $version),
        @('ProductName', ('Shenyi Release Source ' + $version)), @('Manufacturer', 'Shenyi'),
        @('ALLUSERS', '1'), @('INSTALLLEVEL', '1'), @('ARPNOMODIFY', '1'), @('ARPNOREPAIR', '1')
    )
    Write-Idt '_SummaryInformation' @('PropertyId', 'Value') @('i2', 'l255') @('PropertyId') @(
        @('1', '1252'), @('2', 'Installation Database'), @('3', ('Shenyi release source ' + $version)),
        @('4', 'Shenyi'), @('5', 'Installer,MSI,Release Source'), @('6', 'Data-only source transport; no application activation.'),
        @('7', 'x64;1033'), @('9', $packageCode), @('14', '500'), @('15', '2'), @('18', 'Shenyi Native MSI Author')
    )
    $directories = New-Object 'Collections.Generic.List[object]'
    $directories.Add(@('TARGETDIR', '', 'SourceDir'))
    $directories.Add(@('ProgramFiles64Folder', 'TARGETDIR', '.:.'))
    $directories.Add(@('SHENYIROOT', 'ProgramFiles64Folder', 'Shenyi:.'))
    $directories.Add(@('RELEASESOURCE', 'SHENYIROOT', 'RELEAS~1|ReleaseSource:.'))
    $directories.Add(@('VERSIONROOT', 'RELEASESOURCE', ('VERSION|' + $version + ':.')))
    $directoryIds = New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    $directoryIds.Add('', 'VERSIONROOT')
    $componentRows = New-Object 'Collections.Generic.List[object]'
    $fileRows = New-Object 'Collections.Generic.List[object]'
    $featureRows = New-Object 'Collections.Generic.List[object]'
    $featureComponents = New-Object 'Collections.Generic.List[object]'
    $folderComponents = New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    $ddf = New-Object 'Collections.Generic.List[string]'
    foreach ($line in @('.OPTION EXPLICIT', '.Set CabinetNameTemplate=payload.cab', '.Set DiskDirectoryTemplate=.', '.Set Cabinet=ON', '.Set Compress=ON', '.Set CompressionType=MSZIP', '.Set MaxDiskSize=0', '.Set MaxCabinetSize=0', '.Set InfFileName=payload.inf', '.Set RptFileName=payload.rpt')) { $ddf.Add($line) }
    $filenames = [string[]]@($declared.Keys)
    [Array]::Sort($filenames, [StringComparer]::Ordinal)
    $sequence = 0
    foreach ($relative in $filenames) {
        $sequence++
        $parts = $relative.Split('/')
        $parent = ''
        for ($index = 0; $index -lt $parts.Length - 1; $index++) {
            $next = if ($parent) { $parent + '/' + $parts[$index] } else { $parts[$index] }
            if (-not $directoryIds.ContainsKey($next)) {
                $id = 'D' + (Hex-Hash $next).Substring(0, 24)
                $short = 'D' + $directoryIds.Count.ToString('D7')
                $directories.Add(@($id, $directoryIds[$parent], ($short + '|' + $parts[$index])))
                $directoryIds.Add($next, $id)
            }
            $parent = $next
        }
        $token = (Hex-Hash $relative).Substring(0, 24)
        $fileId = 'F' + $token
        $componentId = 'C' + $token
        $featureId = 'Release' + ([int][Math]::Floor(($sequence - 1) / 1000)).ToString('D2')
        if (($sequence - 1) % 1000 -eq 0) { $featureRows.Add(@($featureId, '', 'Release source', '', '0', '1', 'VERSIONROOT', '24')) }
        $componentRows.Add(@($componentId, (Named-Guid ('component|' + $version + '|' + $relative)), $directoryIds[$parent], '256', '', $fileId))
        foreach ($folder in @('SHENYIROOT', 'RELEASESOURCE', 'VERSIONROOT', $directoryIds[$parent])) {
            if (-not $folderComponents.ContainsKey($folder)) { $folderComponents.Add($folder, $componentId) }
        }
        $folderPath = ''
        for ($index = 0; $index -lt $parts.Length - 1; $index++) {
            $folderPath = if ($folderPath) { $folderPath + '/' + $parts[$index] } else { $parts[$index] }
            $folder = $directoryIds[$folderPath]
            if (-not $folderComponents.ContainsKey($folder)) { $folderComponents.Add($folder, $componentId) }
        }
        $featureComponents.Add(@($featureId, $componentId))
        $fileRows.Add(@($fileId, $componentId, ('F' + $sequence.ToString('D7') + '|' + $parts[-1]), [string]$declared[$relative], '', '', '16896', [string]$sequence))
        # Relative sources avoid leaking full source paths into directive files and CAB metadata.
        $source = '..\..\' + [IO.Path]::GetFileName($payloadDirectory) + '\' + $relative.Replace('/', '\')
        $ddf.Add(('"' + $source + '" ' + $fileId))
    }
    Write-Idt 'Directory' @('Directory', 'Directory_Parent', 'DefaultDir') @('s72', 'S72', 'l255') @('Directory') $directories.ToArray()
    Write-Idt 'Component' @('Component', 'ComponentId', 'Directory_', 'Attributes', 'Condition', 'KeyPath') @('s72', 'S38', 's72', 'i2', 'S255', 'S72') @('Component') $componentRows.ToArray()
    Write-Idt 'File' @('File', 'Component_', 'FileName', 'FileSize', 'Version', 'Language', 'Attributes', 'Sequence') @('s72', 's72', 'l255', 'i4', 'S72', 'S20', 'I2', 'i2') @('File') $fileRows.ToArray()
    Write-Idt 'Feature' @('Feature', 'Feature_Parent', 'Title', 'Description', 'Display', 'Level', 'Directory_', 'Attributes') @('s38', 'S38', 'L64', 'L255', 'I2', 'i2', 'S72', 'i2') @('Feature') $featureRows.ToArray()
    Write-Idt 'FeatureComponents' @('Feature_', 'Component_') @('s38', 's72') @('Feature_', 'Component_') $featureComponents.ToArray()
    $folderRows = New-Object 'Collections.Generic.List[object]'
    foreach ($folder in $folderComponents.Keys) { $folderRows.Add(@($folder, $folderComponents[$folder])) }
    Write-Idt 'CreateFolder' @('Directory_', 'Component_') @('s72', 's72') @('Directory_', 'Component_') $folderRows.ToArray()
    Write-Idt 'Media' @('DiskId', 'LastSequence', 'DiskPrompt', 'Cabinet', 'VolumeLabel', 'Source') @('i2', 'i2', 'L64', 'S255', 'S32', 'S72') @('DiskId') @(@('1', [string]$sequence, '', '#payload.cab', '', ''))
    $normalSequence = @(
        @('LaunchConditions', '', '100'), @('CostInitialize', '', '800'), @('FileCost', '', '900'), @('CostFinalize', '', '1000'),
        @('InstallValidate', '', '1400'), @('InstallInitialize', '', '1500'), @('ProcessComponents', '', '1600'),
        @('UnpublishFeatures', '', '1800'), @('RemoveFiles', '', '3500'), @('RemoveFolders', '', '3600'), @('CreateFolders', '', '3700'),
        @('InstallFiles', '', '4000'), @('RegisterUser', '', '6000'), @('RegisterProduct', '', '6100'),
        @('PublishFeatures', '', '6300'), @('PublishProduct', '', '6400'), @('InstallFinalize', '', '6600')
    )
    $adminSequence = @(@('CostInitialize', '', '800'), @('FileCost', '', '900'), @('CostFinalize', '', '1000'), @('InstallValidate', '', '1400'), @('InstallInitialize', '', '1500'), @('InstallAdminPackage', '', '3900'), @('InstallFiles', '', '4000'), @('InstallFinalize', '', '6600'))
    Write-Idt 'InstallExecuteSequence' @('Action', 'Condition', 'Sequence') @('s72', 'S255', 'I2') @('Action') $normalSequence
    Write-Idt 'AdminExecuteSequence' @('Action', 'Condition', 'Sequence') @('s72', 'S255', 'I2') @('Action') $adminSequence
    Write-Idt 'LaunchCondition' @('Condition', 'Description') @('s255', 'l255') @('Condition') @(@('VersionNT64', 'A 64-bit Windows system is required.'))
    [IO.File]::WriteAllText((Join-Path $script:authorDirectory 'payload.ddf'), (($ddf -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
    $makecab = Join-Path ([Environment]::SystemDirectory) 'makecab.exe'
    # PS 5.1's native-command handling depends on PATHEXT and can launch an EXE
    # asynchronously when that variable is absent. Use CreateProcess explicitly.
    $cabProcess = New-Object Diagnostics.Process
    $cabStart = New-Object Diagnostics.ProcessStartInfo
    $cabStart.FileName = $makecab
    $cabStart.Arguments = '/F payload.ddf'
    $cabStart.WorkingDirectory = $script:authorDirectory
    $cabStart.UseShellExecute = $false
    $cabStart.CreateNoWindow = $true
    $cabStart.RedirectStandardOutput = $true
    $cabStart.RedirectStandardError = $true
    $cabStart.EnvironmentVariables.Clear()
    $cabStart.EnvironmentVariables['SystemRoot'] = [IO.Directory]::GetParent([Environment]::SystemDirectory).FullName
    $cabStart.EnvironmentVariables['windir'] = $cabStart.EnvironmentVariables['SystemRoot']
    $cabStart.EnvironmentVariables['Path'] = [Environment]::SystemDirectory
    $cabTemporary = Join-Path $script:authorDirectory 'native-temp'
    [void][IO.Directory]::CreateDirectory($cabTemporary)
    $cabStart.EnvironmentVariables['TEMP'] = $cabTemporary
    $cabStart.EnvironmentVariables['TMP'] = $cabTemporary
    $cabProcess.StartInfo = $cabStart
    $cabOutPath = Join-Path $script:authorDirectory 'makecab.stdout.bin'
    $cabErrorPath = Join-Path $script:authorDirectory 'makecab.stderr.bin'
    $cabOut = [IO.File]::Open($cabOutPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $cabError = [IO.File]::Open($cabErrorPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        if (-not $cabProcess.Start()) { throw 'Native makecab did not start.' }
        $copyOut = $cabProcess.StandardOutput.BaseStream.CopyToAsync($cabOut)
        $copyError = $cabProcess.StandardError.BaseStream.CopyToAsync($cabError)
        $cabCompleted = $cabProcess.WaitForExit(120000)
        if (-not $cabCompleted) { $cabProcess.Kill(); $cabProcess.WaitForExit() }
        [void]$copyOut.GetAwaiter().GetResult()
        [void]$copyError.GetAwaiter().GetResult()
        $cabExit = $cabProcess.ExitCode
    }
    finally { $cabOut.Dispose(); $cabError.Dispose(); $cabProcess.Dispose() }
    $cabEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
    $cabOutput = $cabEncoding.GetString([IO.File]::ReadAllBytes($cabOutPath))
    $cabErrors = $cabEncoding.GetString([IO.File]::ReadAllBytes($cabErrorPath))
    [IO.File]::WriteAllText((Join-Path $script:authorDirectory 'makecab.log'), ('exit=' + $cabExit + "`r`nSTDOUT:`r`n" + $cabOutput + "`r`nSTDERR:`r`n" + $cabErrors), [Text.Encoding]::UTF8)
    if (-not $cabCompleted) { throw 'Native makecab timed out; raw output is retained.' }
    if ($cabExit -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $script:authorDirectory 'payload.cab') -PathType Leaf)) { throw 'Native makecab failed.' }
    $view = $script:database.OpenView('INSERT INTO `_Streams` (`Name`, `Data`) VALUES (?, ?)')
    $record = $installer.CreateRecord([int]2)
    $record.GetType().InvokeMember('StringData', [Reflection.BindingFlags]::SetProperty, $null, $record, @([int]1, [string]'payload.cab')) | Out-Null
    $record.SetStream([int]2, [string](Join-Path $script:authorDirectory 'payload.cab'))
    $view.Execute($record)
    $view.Close()
    $script:database.Commit()
    [pscustomobject]@{ ok = $true; msiPath = $msiPath; version = $version; productCode = $productCode; packageCode = $packageCode; fileCount = $sequence; payloadBytes = $totalBytes; nativeCabinet = $true; customActions = $false } | ConvertTo-Json -Compress
}
catch {
    if ($null -ne $installer) {
        try { $last = $installer.LastErrorRecord; if ($null -ne $last) { [Console]::Error.WriteLine($last.FormatText()); Release-Com $last } } catch {}
    }
    throw
}
finally { Release-Com $record; Release-Com $view; Release-Com $script:database; Release-Com $installer }
