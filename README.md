# GradMe

Paper organizer, notes, and AI query app built with Next.js.

## Quick start (clone and run)

```bash
git clone <YOUR_REPO_URL>
cd gradme
npm install
npm run dev
```

Open `http://localhost:3000`.

If port `3000` is already in use, Next.js automatically uses the next free port (for example `3001`).

## Requirements

- Node.js 20 or newer
- npm 10 or newer

Check versions:

```bash
node -v
npm -v
```

## Optional environment variable

No required `.env` variables for local start.

Use this only if you want to override the local data directory:

```bash
GRADME_DATA_DIR=C:\path\to\gradme-data
```

Create `.env.local` in the project root and add that line.

Default data directory:

- Windows: `%APPDATA%\\GradMe`
- macOS: `~/Library/Application Support/GradMe`
- Linux: `~/.local/share/GradMe`

## Common errors and fixes

### `'next' is not recognized as an internal or external command`

Dependencies are not installed yet.

```bash
npm install
npm run dev
```

### `Module not found: Can't resolve '@google/genai'`

Install dependencies again from the project root.

```bash
npm install
npm ls @google/genai --depth=0
npm run dev
```

If it still fails:

```bash
npm install @google/genai
npm run dev
```

### `Unable to acquire lock at ... .next/dev/lock`

Another `next dev` process is still running.

PowerShell:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "gradme" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Then restart:

```bash
npm run dev
```

## Useful scripts

```bash
npm run dev
npm run lint
npm run test
npm run typecheck
npm run build
npm run start
```

---

## 한국어 가이드 (KO)

논문 정리, 노트, AI 질의 기능을 제공하는 Next.js 앱입니다.

## 빠른 시작 (클론 후 실행)

```bash
git clone <YOUR_REPO_URL>
cd gradme
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 을 엽니다.

`3000` 포트가 이미 사용 중이면 Next.js가 자동으로 다음 빈 포트(예: `3001`)를 사용합니다.

## 요구 사항

- Node.js 20 이상
- npm 10 이상

버전 확인:

```bash
node -v
npm -v
```

## 선택 환경 변수

로컬 실행에는 필수 `.env` 값이 없습니다.

앱 데이터 저장 경로를 바꾸고 싶을 때만 아래 값을 사용합니다.

```bash
GRADME_DATA_DIR=C:\path\to\gradme-data
```

프로젝트 루트에 `.env.local` 파일을 만들고 위 내용을 추가하세요.

기본 데이터 저장 경로:

- Windows: `%APPDATA%\\GradMe`
- macOS: `~/Library/Application Support/GradMe`
- Linux: `~/.local/share/GradMe`

## 자주 발생하는 오류와 해결

### `'next' is not recognized as an internal or external command`

의존성이 설치되지 않은 상태입니다.

```bash
npm install
npm run dev
```

### `Module not found: Can't resolve '@google/genai'`

프로젝트 루트에서 의존성을 다시 설치합니다.

```bash
npm install
npm ls @google/genai --depth=0
npm run dev
```

계속 실패하면:

```bash
npm install @google/genai
npm run dev
```

### `Unable to acquire lock at ... .next/dev/lock`

이전에 실행한 `next dev` 프로세스가 남아있는 상태입니다.

PowerShell:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "gradme" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

정리 후 다시 실행:

```bash
npm run dev
```

## 자주 쓰는 스크립트

```bash
npm run dev
npm run lint
npm run test
npm run typecheck
npm run build
npm run start
```
