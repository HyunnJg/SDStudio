# Windows의 Electron 부분 설치 복구

2026-11-22 사용자 보고: Node26.13.1/npm11.21.3에서 npm ci는89패키지를 설치했지만 Electron dist에는 locales만 남고 path.txt/실행 파일이 없었다. 직접 install.js를 실행해도 종료됐다. install.js3122바이트와 SHA-256 fe3968b51f44b08b4943f4055c0c53c8725028b218ce093e96703deb4fbb301c는 원본과 같았고 win32/x64, 강제 platform/override/NODE_OPTIONS는 없었다. 다운로드 생략 변수 제거로도 해결되지 않았다. **설치 중단의 정확한 원인은 미확정**이며 Node26 버그나 보안 프로그램 탓으로 단정하지 않는다.

공식 Electron26.6.10 Win64 ZIP을 로컬 checksums.json과 같은 고정 SHA-256으로 검증해 PowerShell로 해제하는 경로를 안내했다. 사용자는 이후 창을 열어 실제 API응답을 받았다고 보고했다. 이 환경에서 PowerShell을 실행한 자동 검증이나 전체 앱 네이티브 빌드 성공은 아니다.

저장소 루트에서 실행한다. 다운로드/해시 검증이 실패하면 블록이 중단되며, 프로필·토큰·프로젝트를 읽거나 지우지 않는다. 대상은 tools/nai-validation의 Electron 의존성 폴더뿐이다. Electron 버전을 바꿀 때 이 파일의 URL/해시도 검토해야 한다.

```powershell
& {
    $electronDir = (Resolve-Path ".\tools\nai-validation\node_modules\electron").Path
    $archivePath = Join-Path $env:TEMP ("electron-" + [guid]::NewGuid() + ".zip")
    $downloadUrl = "https://github.com/electron/electron/releases/download/v26.6.10/electron-v26.6.10-win32-x64.zip"
    $expectedHash = "60ae3be784ef8a44b6ac7d0611944696c43c5b88c943a15f1732058b07c331c7"
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath -ErrorAction Stop
    $actualHash = (Get-FileHash $archivePath -Algorithm SHA256 -ErrorAction Stop).Hash
    if ($actualHash -ne $expectedHash) { throw "Archive hash mismatch" }
    Expand-Archive -LiteralPath $archivePath -DestinationPath "$electronDir\dist" -Force -ErrorAction Stop
    if (!(Test-Path "$electronDir\dist\electron.exe")) { throw "electron.exe is missing" }
    [System.IO.File]::WriteAllText("$electronDir\path.txt", "electron.exe", [System.Text.Encoding]::ASCII)
    Remove-Item -LiteralPath $archivePath -ErrorAction SilentlyContinue
}
```

이후 일반 npm start 명령을 사용한다. 코드만 갱신할 때 npm ci를 반복하면 수동 복구한 실행 파일도 삭제될 수 있으므로, 의존성이 바뀌지 않은 이번 후속에는 재설치가 필요 없다. npm audit fix --force로 고정 버전을 바꾸는 복구를 요구하지 않는다. [공식 릴리스](https://github.com/electron/electron/releases/tag/v26.6.10), [실험 실행](README.md).
