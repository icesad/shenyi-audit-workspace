[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Policy([bool]$Condition, [string]$Code) {
    if (-not $Condition) { throw $Code }
}

function Release-Com($Object) {
    if ($null -ne $Object) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Object) }
}

function Read-Rows([string]$Query, [int]$Width, [switch]$MeasureStream) {
    $view = $database.OpenView($Query)
    try {
        [void]$view.Execute()
        while ($null -ne ($record = $view.Fetch())) {
            try {
                $row = foreach ($column in 1..$Width) {
                    if ($MeasureStream -and $column -eq $Width) { [string]$record.DataSize($column) }
                    else { [string]$record.StringData($column) }
                }
                ,@($row)
            }
            finally { Release-Com $record }
        }
    }
    finally { [void]$view.Close(); Release-Com $view }
}

function Assert-Sequence([object[]]$Rows, [string[]]$Expected) {
    $actual = @($Rows | ForEach-Object {
        Assert-Policy ($_[1] -ceq '') 'MSI_SOURCE_POLICY_SEQUENCE'
        $_[0] + '=' + $_[2]
    })
    Assert-Policy ((($actual | Sort-Object) -join '|') -ceq (($Expected | Sort-Object) -join '|')) 'MSI_SOURCE_POLICY_SEQUENCE'
}

function Get-ShortLongName([string]$Value, [string]$ShortPattern) {
    # The authoring tool uses the same invariant names on both installer filesystems.
    Assert-Policy ($Value -cmatch ('^' + $ShortPattern + '\|([A-Za-z0-9_@+\-][A-Za-z0-9._@+\-]{0,119})$')) 'MSI_SOURCE_POLICY_PATH'
    $name = $Matches[1]
    Assert-Policy (-not $name.EndsWith('.') -and $name -notmatch '^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)') 'MSI_SOURCE_POLICY_PATH'
    return $name
}

$file = $installer = $database = $summaryInfo = $null
try {
    Assert-Policy ([Environment]::Is64BitProcess -and [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) 'MSI_SOURCE_POLICY_WINDOWS_REQUIRED'
    Assert-Policy ($MsiPath -match '^[A-Za-z]:[\\/]' -and $MsiPath.Substring(2) -notmatch '[:"\x00-\x1f\x7f]') 'MSI_SOURCE_POLICY_INPUT'
    $fullPath = [IO.Path]::GetFullPath($MsiPath)
    Assert-Policy ([IO.Path]::GetExtension($fullPath) -ieq '.msi') 'MSI_SOURCE_POLICY_INPUT'
    $entry = Get-Item -LiteralPath $fullPath -Force
    Assert-Policy (-not $entry.PSIsContainer) 'MSI_SOURCE_POLICY_INPUT'
    while ($null -ne $entry) {
        Assert-Policy (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'MSI_SOURCE_POLICY_INPUT'
        $parentPath = [IO.Path]::GetDirectoryName($entry.FullName)
        $entry = if ($parentPath) { Get-Item -LiteralPath $parentPath -Force } else { $null }
    }
    # Hold the exact file against writes and deletion while the read-only COM database is open.
    $file = [IO.File]::Open($fullPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $sha256 = [BitConverter]::ToString($algorithm.ComputeHash($file)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
    Assert-Policy ($sha256 -ceq $ExpectedSha256.ToLowerInvariant()) 'MSI_SOURCE_POLICY_DIGEST'

    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($fullPath, [int]0)
    $summaryInfo = $database.SummaryInformation(0)
    $template = [string]$summaryInfo.Property(7)
    $packageCode = [string]$summaryInfo.Property(9)
    $guidPattern = '^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$'
    Assert-Policy ($template -ceq 'x64;1033' -and $packageCode -cmatch $guidPattern -and
        [int]$summaryInfo.Property(14) -eq 500 -and [int]$summaryInfo.Property(15) -eq 2) 'MSI_SOURCE_POLICY_SUMMARY'

    $tables = @(Read-Rows 'SELECT `Name` FROM `_Tables`' 1 | ForEach-Object { $_[0] } | Sort-Object)
    $expectedTables = @('Property','Directory','Component','File','Feature','FeatureComponents','CreateFolder','Media',
        'InstallExecuteSequence','AdminExecuteSequence','LaunchCondition') | Sort-Object
    Assert-Policy (($tables -join '|') -ceq ($expectedTables -join '|')) 'MSI_SOURCE_POLICY_TABLES'

    $properties = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($row in @(Read-Rows 'SELECT `Property`,`Value` FROM `Property`' 2)) { $properties.Add($row[0], $row[1]) }
    $expectedProperties = @{ ProductVersion = $ExpectedVersion; ProductLanguage = '1033'; ProductName = 'Shenyi Release Source ' + $ExpectedVersion;
        Manufacturer = 'Shenyi'; ALLUSERS = '1'; INSTALLLEVEL = '1'; ARPNOMODIFY = '1'; ARPNOREPAIR = '1' }
    Assert-Policy ($properties.Count -eq ($expectedProperties.Count + 1) -and $properties['ProductCode'] -cmatch $guidPattern) 'MSI_SOURCE_POLICY_PROPERTIES'
    foreach ($name in $expectedProperties.Keys) {
        Assert-Policy ($properties[$name] -ceq $expectedProperties[$name]) 'MSI_SOURCE_POLICY_PROPERTIES'
    }
    $launch = @(Read-Rows 'SELECT `Condition` FROM `LaunchCondition`' 1)
    Assert-Policy ($launch.Count -eq 1 -and $launch[0][0] -ceq 'VersionNT64') 'MSI_SOURCE_POLICY_PROPERTIES'

    $costActions = @('CostInitialize=800','FileCost=900','CostFinalize=1000','InstallValidate=1400','InstallInitialize=1500',
        'InstallFiles=4000','InstallFinalize=6600')
    Assert-Sequence @(Read-Rows 'SELECT `Action`,`Condition`,`Sequence` FROM `InstallExecuteSequence`' 3) ($costActions + @(
        'LaunchConditions=100','ProcessComponents=1600','UnpublishFeatures=1800','RemoveFiles=3500','RemoveFolders=3600',
        'CreateFolders=3700','RegisterUser=6000','RegisterProduct=6100','PublishFeatures=6300','PublishProduct=6400'))
    Assert-Sequence @(Read-Rows 'SELECT `Action`,`Condition`,`Sequence` FROM `AdminExecuteSequence`' 3) ($costActions + @('InstallAdminPackage=3900'))

    $directories = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    foreach ($row in @(Read-Rows 'SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory`' 3)) { $directories.Add($row[0], @($row[1], $row[2])) }
    $anchors = @{ TARGETDIR = @('', 'SourceDir'); ProgramFiles64Folder = @('TARGETDIR', '.:.'); SHENYIROOT = @('ProgramFiles64Folder', 'Shenyi:.');
        RELEASESOURCE = @('SHENYIROOT', 'RELEAS~1|ReleaseSource:.'); VERSIONROOT = @('RELEASESOURCE', ('VERSION|' + $ExpectedVersion + ':.')) }
    foreach ($name in $anchors.Keys) {
        Assert-Policy ($directories.ContainsKey($name) -and ($directories[$name] -join '/') -ceq ($anchors[$name] -join '/')) 'MSI_SOURCE_POLICY_PATH'
    }
    $relativeDirs = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    $relativeDirs.Add('VERSIONROOT', '')
    $relativeNames = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($id in $directories.Keys) {
        if ($anchors.ContainsKey($id)) { continue }
        $segments = New-Object 'Collections.Generic.List[string]'
        $current = $id
        while ($current -cne 'VERSIONROOT') {
            Assert-Policy ($current -cmatch '^D[0-9a-f]{24}$' -and $directories.ContainsKey($current) -and $segments.Count -lt 120) 'MSI_SOURCE_POLICY_PATH'
            $directory = $directories[$current]
            $segments.Insert(0, (Get-ShortLongName $directory[1] 'D[0-9]{7}'))
            $current = $directory[0]
        }
        $relative = $segments -join '/'
        Assert-Policy (($relative -ceq 'bundle' -or $relative.StartsWith('bundle/', [StringComparison]::Ordinal)) -and
            $relative.Length -lt 240 -and $relativeNames.Add($relative)) 'MSI_SOURCE_POLICY_PATH'
        $relativeDirs.Add($id, $relative)
    }

    $components = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    $componentGuids = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($row in @(Read-Rows 'SELECT `Component`,`ComponentId`,`Directory_`,`Attributes`,`Condition`,`KeyPath` FROM `Component`' 6)) {
        Assert-Policy ($row[0] -cmatch '^C[0-9a-f]{24}$' -and $row[1] -cmatch $guidPattern -and $componentGuids.Add($row[1]) -and
            $relativeDirs.ContainsKey($row[2]) -and $row[3] -ceq '256' -and $row[4] -ceq '' -and
            $row[5] -ceq ('F' + $row[0].Substring(1))) 'MSI_SOURCE_POLICY_COMPONENTS'
        $components.Add($row[0], @($row[2], $row[5]))
    }
    $paths = [Collections.Generic.Dictionary[string,long]]::new([StringComparer]::Ordinal)
    $fileFeatures = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    $fileNames = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $totalBytes = [long]0
    $fileCount = 0
    foreach ($row in @(Read-Rows 'SELECT `File`,`Component_`,`FileName`,`FileSize`,`Version`,`Language`,`Attributes`,`Sequence` FROM `File` ORDER BY `Sequence`' 8)) {
        $fileCount++
        Assert-Policy ($components.ContainsKey($row[1]) -and $components[$row[1]][1] -ceq $row[0] -and $row[3] -match '^[0-9]+$' -and
            $row[4] -ceq '' -and $row[5] -ceq '' -and $row[6] -ceq '16896' -and $row[7] -ceq [string]$fileCount) 'MSI_SOURCE_POLICY_FILES'
        $name = Get-ShortLongName $row[2] ('F' + $fileCount.ToString('D7'))
        $parent = $relativeDirs[$components[$row[1]][0]]
        $relative = if ($parent) { $parent + '/' + $name } else { $name }
        Assert-Policy (($relative -ceq 'signature.ed25519' -or $relative.StartsWith('bundle/', [StringComparison]::Ordinal)) -and
            $relative.Length -le 240 -and -not $relativeNames.Contains($relative) -and $fileNames.Add($relative)) 'MSI_SOURCE_POLICY_PATH'
        $paths.Add($relative, [long]$row[3])
        $groupIndex = [int][Math]::Floor(($fileCount - 1) / 1000)
        $fileFeatures.Add($row[1], ('Release' + $groupIndex.ToString('D2')))
        $totalBytes += [long]$row[3]
    }
    Assert-Policy ($fileCount -ge 3 -and $fileCount -eq $components.Count -and $paths['signature.ed25519'] -eq 64 -and
        $paths['bundle/candidate-manifest.json'] -gt 0 -and $paths['bundle/Shenyi.exe'] -gt 0) 'MSI_SOURCE_POLICY_FILES'

    $features = @(Read-Rows 'SELECT `Feature`,`Feature_Parent`,`Title`,`Description`,`Display`,`Level`,`Directory_`,`Attributes` FROM `Feature` ORDER BY `Feature`' 8)
    Assert-Policy ($features.Count -eq [Math]::Ceiling($fileCount / 1000)) 'MSI_SOURCE_POLICY_FEATURES'
    for ($index = 0; $index -lt $features.Count; $index++) {
        Assert-Policy (($features[$index] -join '|') -ceq ('Release' + $index.ToString('D2') + '||Release source||0|1|VERSIONROOT|24')) 'MSI_SOURCE_POLICY_FEATURES'
    }
    $assigned = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($row in @(Read-Rows 'SELECT `Feature_`,`Component_` FROM `FeatureComponents`' 2)) {
        Assert-Policy ($fileFeatures[$row[1]] -ceq $row[0] -and $assigned.Add($row[1])) 'MSI_SOURCE_POLICY_FEATURES'
    }
    Assert-Policy ($assigned.Count -eq $fileCount) 'MSI_SOURCE_POLICY_FEATURES'

    $folders = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($row in @(Read-Rows 'SELECT `Directory_`,`Component_` FROM `CreateFolder`' 2)) {
        Assert-Policy (($relativeDirs.ContainsKey($row[0]) -or $row[0] -cin @('SHENYIROOT', 'RELEASESOURCE')) -and
            $components.ContainsKey($row[1]) -and $folders.Add($row[0])) 'MSI_SOURCE_POLICY_PATH'
    }
    Assert-Policy ($folders.Count -eq ($relativeDirs.Count + 2)) 'MSI_SOURCE_POLICY_PATH'

    $media = @(Read-Rows 'SELECT `DiskId`,`LastSequence`,`DiskPrompt`,`Cabinet`,`VolumeLabel`,`Source` FROM `Media`' 6)
    Assert-Policy ($media.Count -eq 1 -and ($media[0] -join '|') -ceq ('1|' + $fileCount + '||#payload.cab||')) 'MSI_SOURCE_POLICY_MEDIA'
    $streamRows = @(Read-Rows 'SELECT `Name`,`Data` FROM `_Streams`' 2 -MeasureStream)
    $storages = @(Read-Rows 'SELECT `Name` FROM `_Storages`' 1)
    $allowedStreams = @('payload.cab', ([char]5 + 'SummaryInformation'), ([char]5 + 'DigitalSignature'), ([char]5 + 'MsiDigitalSignatureEx'))
    $streamNames = @($streamRows | ForEach-Object { $_[0] })
    Assert-Policy ($storages.Count -eq 0 -and $streamNames -ccontains 'payload.cab' -and $streamNames -ccontains ([char]5 + 'SummaryInformation') -and
        @($streamRows | Where-Object { $_[0] -cnotin $allowedStreams -or [long]$_[1] -le 0 }).Count -eq 0) 'MSI_SOURCE_POLICY_MEDIA'

    [ordered]@{ ok = $true; sourcePolicyVerified = $true; sha256 = $sha256; version = $ExpectedVersion; arch = 'x64';
        productCode = $properties['ProductCode']; packageCode = $packageCode; payloadFileCount = $fileCount; payloadBytes = $totalBytes;
        machineScope = $true; releaseSourceDirectory = "ProgramFiles64Folder/Shenyi/ReleaseSource/$ExpectedVersion";
        installationPerformed = $false; installerSignatureVerified = $false } | ConvertTo-Json -Compress
}
catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally {
    Release-Com $summaryInfo
    Release-Com $database
    Release-Com $installer
    if ($null -ne $file) { $file.Dispose() }
}
