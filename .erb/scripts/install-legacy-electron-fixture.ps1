# CI-only fixture producer; never replaces the application's Electron or a user profile.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or !$env:RUNNER_TEMP) {
    throw 'This installer is only for the disposable Windows CI fixture.'
}
$fixture = Join-Path $env:RUNNER_TEMP 'sdstudio-electron26-fixture'
if (Test-Path -LiteralPath $fixture) { throw 'Fixture directory already exists.' }
$archive = Join-Path $env:RUNNER_TEMP ('electron26-fixture-' + [guid]::NewGuid().ToString('N') + '.zip')
$url = 'https://github.com/electron/electron/releases/download/v26.6.10/electron-v26.6.10-win32-x64.zip'
# Verified against the release's official SHASUMS256.txt, 2026-11-24.
$expected = '60ae3be784ef8a44b6ac7d0611944696c43c5b88c943a15f1732058b07c331c7'
try {
    Invoke-WebRequest -Uri $url -OutFile $archive -TimeoutSec 120
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
        throw 'Legacy fixture archive hash mismatch.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $fixture
    $exe = Join-Path $fixture 'electron.exe'
    if (!(Test-Path -LiteralPath $exe)) { throw 'Fixture executable is missing.' }
    ('SDSTUDIO_LEGACY_ELECTRON=' + $exe) | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
} finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
