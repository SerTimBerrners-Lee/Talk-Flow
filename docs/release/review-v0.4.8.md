# Release Review v0.4.8

## Release

- Version: 0.4.8
- Release branch: `release/v0.4.8`
- Target tag: `v0.4.8`
- Reviewer: Codex
- Date: 2026-08-18

## Scope

- Key changes included in this release: Windows installer closes running Talkis executables before replacing sidecars; stale managed local STT processes are cleaned up during startup and after readiness timeouts; live local STT warm-up no longer blocks microphone capture for the full runtime timeout; local batch transcription always selects an installed local model.
- User-facing changes: updating Talkis on Windows no longer fails when `talkis-stt.exe` is running; recording starts promptly while local STT warms up; a stale cloud transcription model cannot break local Nemotron transcription.
- Risky areas: Windows NSIS update lifecycle, process cleanup, local STT startup and model routing, recording start timing.

## Checks run

- `bun run check:release`: passed locally on Windows (version sync, sidecar preparation, TypeScript, Rust check, hotkey smoke and production frontend build).
- `bun run build:release:windows`: application and NSIS bundle built successfully; the local command stopped only at updater signing because no private updater key is installed on this workstation.
- `bun run verify:windows-release`: passed for the installer hook, Talkis and all Windows sidecars.
- GitHub Release Preflight: pending exact release commit.
- Native/GitHub Windows build: pending exact release commit.
- Native/GitHub Linux build: pending exact release commit.
- Additional manual checks: `bun test` passed 271/271; silent installation completed with exit code 0; installed `Talkis.exe` reports 0.4.8; installed `talkis-stt.exe` SHA-256 matches the bundled 0.4.8 sidecar; direct Nemotron multipart transcription returned HTTP 200 from the installed runtime.

## Manual review

- Hotkey flow: registration confirmed after installed-app startup; end-to-end voice result pending final manual utterance.
- Onboarding permissions: unchanged in this hotfix.
- Widget position and notice behavior: installed widget launched; unchanged presentation in this hotfix.
- Transcription quality and short-utterance handling: local model routing regression is covered by unit tests; end-to-end installed-app confirmation pending.
- README refreshed: yes, English and Russian release notes updated.

## Findings

- Blockers: end-to-end installed-app voice confirmation and exact-commit CI are still required before publishing.
- Non-blocking issues: the Rust test harness on this Windows workstation cannot link the existing native model dependencies because static and dynamic MSVC runtimes conflict; production `cargo check` and the release binary both compile successfully.
- Follow-ups after release: none identified in the hotfix scope.

## Decision

- Ready for `main` merge: no, awaiting installed-app voice confirmation and preflight.
- Release preflight green on exact tag commit: no, not run yet.
- Ready for tag publish: no, not yet.
