# Windows x64 프리릴리스 3.1.12-rc.2

[릴리스 첨부물](https://github.com/HyunnJg/SDStudio/releases/tag/v3.1.12-rc.2)에서 설치 파일, 대응 소스 ZIP, `SHA256SUMS.txt`를 함께 제공한다. Windows 설치 파일은 미서명이다. 받은 파일의 SHA-256은 PowerShell의 `Get-FileHash`로 확인할 수 있다.

## 대응 소스 사용 방법

ZIP의 `SDStudio-source.zip`에는 태그의 앱 코드와 패키지 lock이 있다. `SOURCE-MANIFEST.json`에는 외부 소스·빌드 자료별 원본 URL, 보관 경로, 크기, SHA-256이 있다. `BINARY-SHA256.json`의 경로는 설치된 프로그램 폴더 기준이다. 외부 구성요소의 수정과 재빌드에는 해당 구성요소의 고지와 도구를 사용한다.

앱을 ZIP에서 빌드하려면 `SDStudio-source.zip`을 풀고, 같은 릴리스의 [데스크톱 빌드 소스 보충 ZIP](https://github.com/HyunnJg/SDStudio/releases/download/v3.1.12-rc.2/SDStudio-desktop-build-inputs-3.1.12-rc.2-win-x64.zip)을 루트 `package.json`이 있는 폴더에 푼다. 보충 ZIP의 SHA-256은 `ceffe22a5fcdb40dbb17f1a585a3c7fdca14b1135abaf3ac0dc34c06d29c1a95`다. 이 파일은 앱의 Git 아카이브에서 비어 있던 `externals/capacitor-background-mode/`에 태그가 지정한 커밋의 파일 61개를 복원한다. Git으로 받으려면 `v3.1.12-rc.2`를 clone한 뒤 `git submodule update --init externals/capacitor-background-mode`를 실행한다. [서브모듈 원본](https://github.com/sunho/capacitor-background-mode/tree/dc536b991ef441425ffa2f5e71c2aa90b1daf231) · [설치와 빌드](../DEVELOPMENT.md)

- **sharp 0.35.5와 libvips 8.18.7**. `build-inputs/build-win64-mxe.tar.gz`의 README와 `build.sh --help`에 Windows 교차 빌드 절차가 있다. 이 설치본은 x64 web static 변형이다. 함께 보관한 MXE 소스와 패치, `libvips/`의 구성요소 28종, GLib의 PCRE2 소스와 Meson 패치를 사용한다. librsvg의 Cargo.lock에 있는 레지스트리 패키지 357개는 `libvips/cargo/`에 있다. MSVC용 C++ 바인딩과 Node 애드온은 sharp 소스의 `src/binding.gyp`에서 빌드한다. dev 패키지에 C++ 소스와 헤더가, Windows 개발 ZIP에 import library가 들어 있다. 앱에서 사용하는 DLL과 애드온은 `resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/`에 있다.
- **libimagequant 2.4.1**. 공급자가 버전 태그를 재사용했다. 당시 커밋은 `ce5fdeb1ccd9db288950faa21fd09c42c0a59bbb`다. POSIX 환경에서 아래 명령으로 MXE가 기록한 SHA-256 `47d2a84b7b1052975c9d50a3d4e3cacbf57b43d84a4c3131210848ead9964dfb`의 아카이브를 복원할 수 있다. [공급자 소스](https://github.com/lovell/libimagequant/tree/ce5fdeb1ccd9db288950faa21fd09c42c0a59bbb)
- **ExifTool 12.85와 Strawberry Perl 5.32.1.1 x64**. 공급자의 `update.sh`에 명시된 Oliver Betz 12.82 x64 패키지가 Windows 런타임의 출처다. ExifTool 본체에는 12.85 소스가 사용됐다. ZIP에는 두 프로젝트의 빌드 자료, 런처 소스, Perl 5.32.1 소스, Strawberry의 `share/64bit-5.32.1.1.pp`와 패치, 동봉된 XS 모듈과 런타임 라이브러리의 소스가 들어 있다. Strawberry의 64비트 릴리스 노트에 GCC 설정이 있다.
- **Electron 45.4.1의 FFmpeg**. Electron 태그의 DEPS가 가리키는 Chromium 156.0.8078.100, 그 DEPS에서 지정한 FFmpeg 커밋 `9db86ce5b5b454dfc96c435f9f0723012980c37f`의 코드와 Electron의 `patches/ffmpeg/`를 제공한다. Electron 소스의 빌드 문서로 런타임을 빌드할 수 있다.

```sh
git -c core.autocrlf=false -c tar.umask=0002 archive --format=tar --prefix=libimagequant-2.4.1/ ce5fdeb1ccd9db288950faa21fd09c42c0a59bbb | gzip -n -6 > libimagequant-2.4.1.tar.gz
```

## 설치본 대조

#72 후속 점검에서 공개 앱 소스와 보충 ZIP을 기존 체크아웃 밖의 빈 폴더에 풀었다. Node 26.13.1, npm 11.21.3으로 `npm ci --include=optional`, `npm run verify:desktop`, `npm run build`, Windows x64 NSIS 패키징을 실행했다. 새 미서명 설치 파일을 만들고 패키지 고지 사본 206개를 대조했다. 아래 1,032개 파일 대조는 최초 공개 설치본과 당시의 빌드 폴더에 대한 검증이다. 새로 빌드한 설치 파일과 공개 파일의 비트 단위 재현 여부는 미검증이다.

NSIS에서 꺼낸 파일 1,032개를 디렉터리 패키지와 대조했다. 고지 사본 206개와 Electron·Chromium 고지가 일치했다. 원작 native 모듈은 ISC 선언만 확인돼 별도 고지 원문 누락으로 기록돼 있다. [고지 조사](APP_LICENSE_STATUS.md)

libvips C DLL과 버전 목록은 공식 Windows 개발 ZIP과, C++ DLL과 Node 애드온은 npm lock이 지정한 플랫폼 패키지와 일치했다. ExifTool 패키지의 실행 파일·DLL 38개는 공급자가 지정한 원본 ZIP과 일치했다. FFmpeg DLL은 설치에 사용한 Electron 배포본과 동일했다. 이 검증은 패키지와 공급 원본 간의 대조이며, 모든 외부 라이브러리를 소스에서 다시 빌드한 결과는 미확인이다.
