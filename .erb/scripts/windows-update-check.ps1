$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Use the disposable Windows CI runner for the per-user installation test.'
}
$appProfile = Join-Path $env:APPDATA 'SDStudio-HyunnJg'
if (Test-Path -LiteralPath $appProfile) { throw 'Expected a fresh Windows profile' }
$baseline = '2616fedaa942dc4a394d8d945bd5f94584c6e29e'
$oldTree = Join-Path $env:RUNNER_TEMP 'sdstudio-before-update'
git fetch --depth=1 origin $baseline
git worktree add --detach $oldTree $baseline
Push-Location $oldTree
try {
    git submodule update --init externals/capacitor-background-mode
    npm ci --include=optional --no-audit --no-fund
    npm run package:windows
} finally { Pop-Location }
node node_modules/electron-builder/cli.js --prepackaged release/build/win-unpacked --win nsis --x64 --publish never
function Install-TestBuild($build) {
    $setup = @(Get-ChildItem -LiteralPath $build -File -Filter '* Setup *.exe')
    if ($setup.Count -ne 1) { throw 'Expected exactly one NSIS setup' }
    $setupProcess = Start-Process -FilePath $setup[0].FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    if ($setupProcess.ExitCode -ne 0) { throw "NSIS failed ($($setupProcess.ExitCode))" }
    $installed = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs') -Filter 'sdstudio-hyunnjg.exe' -File -Recurse)
    if ($installed.Count -ne 1) { throw 'Installed app could not be identified' }
    $expected = Get-FileHash -LiteralPath (Join-Path $build 'win-unpacked/resources/app.asar')
    $actual = Get-FileHash -LiteralPath (Join-Path $installed[0].DirectoryName 'resources/app.asar')
    if ($expected.Hash -ne $actual.Hash) { throw 'Installed ASAR differs from the built payload' }
    return $installed[0].FullName
}
$before = Install-TestBuild (Join-Path $oldTree 'release/build')
node -r ts-node/register/transpile-only .erb/scripts/installed-update-probe.cjs $before seed
$after = Install-TestBuild (Resolve-Path release/build)
if ($before -ne $after) { throw 'Update installed to another directory' }
node -r ts-node/register/transpile-only .erb/scripts/installed-update-probe.cjs $after reopen
