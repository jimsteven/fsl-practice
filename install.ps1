# Run from an extracted checkout: powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$installerArgs = @($args)
$temporaryDirectory = $null
$exitCode = 1

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This installer supports Windows only. On macOS or Linux, run ./install.sh instead.'
    }

    $machineArchitecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $machineArchitecture) { $machineArchitecture = $env:PROCESSOR_ARCHITECTURE }
    $architecture = switch ($machineArchitecture) {
        'AMD64' { 'x64' }
        'ARM64' { 'arm64' }
        default { throw "Unsupported Windows architecture: $machineArchitecture. Use Windows x64 or ARM64." }
    }

    $version = 'v24.11.0'
    $runtimeDirectory = Join-Path $PSScriptRoot '.tools\node-runtime'
    $node = Join-Path $runtimeDirectory 'node.exe'
    $installer = Join-Path $PSScriptRoot 'scripts\install.mjs'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw 'scripts/install.mjs is missing. Download and extract the complete repository, then run this installer again.'
    }

    if (-not (Test-Path -LiteralPath $runtimeDirectory)) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('fsl-node-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
        $archiveName = "node-$version-win-$architecture.zip"
        $archive = Join-Path $temporaryDirectory $archiveName
        $checksums = Join-Path $temporaryDirectory 'SHASUMS256.txt'
        $baseUrl = "https://nodejs.org/dist/$version"

        Write-Host "Downloading official Node.js $version for Windows $architecture..."
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archive
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $checksums
        $pattern = '^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($archiveName) + '$'
        $entries = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -match $pattern })
        if ($entries.Count -ne 1) { throw "Official checksum missing or ambiguous for $archiveName. Try again later." }
        $expectedHash = ($entries[0] -split '\s+')[0]
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
            throw 'Node.js SHA256 verification failed. Nothing was extracted. Check your network and retry.'
        }

        # Extract only after verification; move only the new runtime, never delete an existing folder.
        Expand-Archive -LiteralPath $archive -DestinationPath $temporaryDirectory
        $extractedRuntime = Join-Path $temporaryDirectory "node-$version-win-$architecture"
        if (-not (Test-Path -LiteralPath (Join-Path $extractedRuntime 'node.exe') -PathType Leaf)) {
            throw 'The verified Node.js archive did not contain node.exe. Download a fresh repository and retry.'
        }
        New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '.tools') -Force | Out-Null
        if (Test-Path -LiteralPath $runtimeDirectory) {
            throw "The runtime folder appeared during installation. Leave it intact and retry: $runtimeDirectory"
        }
        Move-Item -LiteralPath $extractedRuntime -Destination $runtimeDirectory
    }

    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
        throw "The existing runtime has no node.exe. Move '$runtimeDirectory' aside and rerun this installer."
    }
    $runtimeIdentity = & $node -p "process.version + ':' + process.platform + ':' + process.arch"
    if ($LASTEXITCODE -ne 0 -or $runtimeIdentity -ne "${version}:win32:$architecture") {
        throw "The runtime must be Node.js $version for Windows $architecture. Move '$runtimeDirectory' aside and rerun this installer."
    }

    $env:PATH = $runtimeDirectory + [IO.Path]::PathSeparator + $env:PATH
    & $node $installer @installerArgs
    $exitCode = $LASTEXITCODE
}
catch {
    [Console]::Error.WriteLine("FSL installation failed: $($_.Exception.Message)")
    [Console]::Error.WriteLine('Check your internet connection and that the extracted repository is writable, then rerun install.ps1.')
}
finally {
    if ($temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
