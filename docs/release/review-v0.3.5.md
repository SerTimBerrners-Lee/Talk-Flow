# Release Review v0.3.5

## Release

- Version: 0.3.5
- Release branch: `release/v0.3.5`
- Target tag: `v0.3.5`
- Reviewer: Codex
- Date: 2026-07-02

## Scope

- Key changes included in this release:
  - Local STT requests to localhost runtimes no longer attach the global API key as a bearer token.
  - Widget error mapping now treats local STT `401/403` responses as local runtime errors instead of API-key failures.
  - Widget notice icon layout uses a stable icon column so long messages stay visually aligned.
  - Call-capture permission-like startup errors no longer reset the completed permissions onboarding flag.
- User-facing changes:
  - Local model users should no longer see "check API key" when local runtime auth-like errors occur.
  - Error notices render with a centered icon.
  - Restarting after a call-capture startup failure should not reopen the permissions onboarding only because the app reset its own flag.
- Risky areas:
  - Local STT authorization handling.
  - Permission onboarding persistence after call-capture errors.
  - Widget notice compact/expanded sizing.

## Checks run

- `bun run check:release`: passed
- `bun run build:release:macos`: local build reached `Talkis.app` and updater `.app.tar.gz`, then stopped because `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is not present in the local environment; GitHub Actions is expected to run this step with repository secrets.
- Native/GitHub Windows build: GitHub Actions after tag
- Native/GitHub Linux build: GitHub Actions after tag
- Additional manual checks:
  - `bunx tsc --noEmit`: passed before release prep
  - `cargo check`: passed before release prep

## Manual review

- Hotkey flow: no hotkey reducer changes in this release.
- Onboarding permissions: reviewed `SettingsApp`, `PermissionScreen`, and widget call-capture error handling; removed app-side reset of completed onboarding from call-capture startup errors.
- Widget position and notice behavior: notice bubble positioning unchanged; notice content layout reviewed for compact and expanded message states.
- Transcription quality and short-utterance handling: no transcript filtering changes in this release.
- README refreshed: yes, `v0.3.5` added to Latest Changes.

## Findings

- Blockers: local macOS updater signing needs `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; release publication proceeds through GitHub Actions secrets.
- Non-blocking issues: Windows/Linux artifacts are expected from GitHub Actions, not local macOS. Vite reports the existing large chunk warning during production builds.
- Follow-ups after release: verify GitHub Actions artifacts and updater metadata after tag publish.

## Decision

- Ready for `main` merge: yes
- Ready for tag publish: yes, via GitHub Actions release build
