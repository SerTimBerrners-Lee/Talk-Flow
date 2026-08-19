# Release Review v0.4.8

## Release

- Version: 0.4.8
- Release branch: `release/v0.4.8`
- Target tag: `v0.4.8`
- Reviewer: Codex
- Date: 2026-08-19

## Scope

- Key changes included in this release: Windows installer closes running Talkis executables before replacing sidecars; stale managed local STT processes are cleaned up during startup and after readiness timeouts; live local STT warm-up no longer blocks microphone capture for the full runtime timeout; local batch transcription always selects an installed local model.
- User-facing changes: updating Talkis on Windows no longer fails when `talkis-stt.exe` is running; recording starts promptly while local STT warms up; a stale cloud transcription model cannot break local Nemotron transcription.
- Risky areas: Windows NSIS update lifecycle, process cleanup, local STT startup and model routing, recording start timing.

## Checks run

- `bun run check:release`: passed locally on Windows (version sync, sidecar preparation, TypeScript, Rust check, hotkey smoke and production frontend build).
- `bun run build:release:windows`: application and NSIS bundle built successfully; the local command stopped only at updater signing because no private updater key is installed on this workstation.
- `bun run verify:windows-release`: passed for the installer hook, Talkis and all Windows sidecars.
- GitHub Release Preflight: passed on the implementation commit in [run 32142550545](https://github.com/SerTimBerrners-Lee/talkis/actions/runs/32142550545); the final review-only commit must receive the same required check before tagging.
- Native/GitHub Windows build: passed, including NSIS packaging and Windows x64 release verification.
- Native/GitHub Linux build: passed for AppImage and DEB artifacts.
- Additional manual checks: `bun test` passed 271/271; silent installation completed with exit code 0; installed `Talkis.exe` reports 0.4.8; installed `talkis-stt.exe` SHA-256 matches the bundled 0.4.8 sidecar; direct Nemotron multipart transcription returned HTTP 200 from the installed runtime.

## Manual review

- Hotkey flow: registration confirmed after installed-app startup; hotkey state tests passed; the exact local-model routing regression is covered separately from the installed-runtime speech test.
- Onboarding permissions: unchanged in this hotfix.
- Widget position and notice behavior: installed widget launched; unchanged presentation in this hotfix.
- Transcription quality and short-utterance handling: local model routing regression is covered by unit tests; the installed Nemotron runtime accurately transcribed a generated Russian speech sample through the production HTTP path.
- README refreshed: yes, English and Russian release notes updated.

## Findings

- Blockers: none; the final review-only commit must pass the required preflight before the tag is pushed.
- Non-blocking issues: the Rust test harness on this Windows workstation cannot link the existing native model dependencies because static and dynamic MSVC runtimes conflict; production `cargo check` and the release binary both compile successfully.
- Follow-ups after release: none identified in the hotfix scope.

## Decision

- Ready for `main` merge: yes, after the final review commit passes preflight.
- Release preflight green on exact tag commit: yes, enforced by rerunning preflight after this review update and before tagging.
- Ready for tag publish: yes, after that exact-commit preflight succeeds.
