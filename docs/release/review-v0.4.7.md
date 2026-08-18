# Release Review v0.4.7

## Release

- Version: 0.4.7
- Release branch: `release/v0.4.7`
- Target tag: `v0.4.7`
- Reviewer: Codex
- Date: 2026-08-18

## Scope

- Key changes included in this release:
  - Makes Windows onboarding download a local STT model before starting the managed runtime, reads installed models directly from disk, adds runtime warm-up, bypasses system proxies for loopback traffic, and drains sidecar stdout/stderr into structured logs.
  - Discovers Rust, Visual Studio C++ tools, CMake, and LLVM for Windows development commands and aligns application/sidecar CRT settings.
  - Opens Talkis from the Windows widget, persists recognition/translation mode changes, and adds a hybrid native Windows title bar.
  - Replaces competing widget error surfaces with one expandable bottom status bar that supports copy, and makes Windows clipboard shortcuts independent of the active keyboard layout.
  - Keeps the floating widget persistent by preventing close requests, recreating a destroyed window, restoring hidden/minimized windows, and moving inaccessible windows onto an available monitor without taking keyboard focus.
  - Keeps macOS call capture from changing the default output route or opening a competing WebView microphone when native microphone capture is active.
  - Updates the version, English/Russian release notes, Rust formatting, and cross-platform release checks for `v0.4.7`.
- User-facing changes:
  - Removes the long pre-download wait and the common local-runtime timeout path during Windows first-run setup.
  - Makes the Windows widget, mode selector, title bar, paste path, and error display behave consistently in daily use.
  - Prevents a running Talkis process from remaining only in the tray with no accessible widget.
  - Prevents ordinary macOS call recording from making the call quieter or temporarily replacing the call application's microphone route.
- Risky areas:
  - Managed local STT process startup, port selection, readiness detection, proxy bypass, and model/runtime synchronization.
  - Windows DWM title-bar integration, single-instance behavior, and persistent widget window lifecycle.
  - macOS Core Audio process taps and native/WebView microphone fallback selection.
  - Windows physical-key clipboard simulation across keyboard layouts.
  - Cross-platform release command changes used by all three preflight runners.

## Checks run

- `bun test`: passed, `265/265` tests across 35 files.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: passed after applying the current Rustfmt output to the included STT changes.
- `CARGO_INCREMENTAL=0 bun run check:release`: passed on Windows; includes synchronized `0.4.7` versions, sidecar preparation, TypeScript and Rust checks, hotkey smoke `6/6`, and the production frontend build.
- `bun run build:release:windows`: compiled the optimized application and all release sidecars and created `Talkis_0.4.7_x64-setup.exe`; the command then stopped at updater signing because this workstation does not contain `TAURI_SIGNING_PRIVATE_KEY`.
- `bun run verify:windows-release`: passed for `Talkis.exe`, ffmpeg, STT, diarization, LLM, and the NSIS installer. The application reports product/file version `0.4.7`; the installer is 32,582,406 bytes with local SHA-256 `219cba2ed23ee401ce5ae779e910b369e36e8a5ed1996872b05554d865360b33`.
- `cargo test --release --manifest-path src-tauri/Cargo.toml --lib` with the static Windows CRT settings: compiled successfully, but the generated test harness could not start because a native model DLL reported `STATUS_ENTRYPOINT_NOT_FOUND`; no Rust test cases ran in that harness.
- Standalone widget visibility tests: passed, `3/3` (disconnected monitor, inaccessible sliver, and already-visible position).
- Local macOS build: not available from this Windows workstation; GitHub preflight is required.
- GitHub Release Preflight: pending for the exact release commit.
- Native/GitHub Windows build: local compile, NSIS bundle, and architecture checks passed; updater signing pending GitHub repository secrets.
- Native/GitHub Linux build: pending GitHub preflight.
- Additional manual checks:
  - Reviewed every commit and the full file list from `v0.4.6` through the release branch; no generated binaries are included in Git.
  - Confirmed `package.json`, both Cargo workspace versions, both Talkis entries in `Cargo.lock`, and `tauri.conf.json` are `0.4.7`.
  - Confirmed `.github/workflows/release-preflight.yml` and `.github/workflows/release.yml` still enforce three successful platform checks on the exact commit before publishing.

## Manual review

- Hotkey flow: frontend suite passed, including transaction/rollback coverage; mandatory FSM smoke passed `6/6`.
- Onboarding permissions: Windows top offset no longer exposes the main screen; model download and activation are separate visible stages. A real macOS permission/update cycle still requires hardware validation.
- Widget position and notice behavior: standalone visibility tests passed `3/3`; error status-bar tests and widget sizing tests passed in the frontend suite.
- Transcription quality and short-utterance handling: unchanged filters passed in the frontend suite; local STT lifecycle/proxy changes compiled, but a physical Windows model dictation should still be checked from the published candidate.
- Call capture: microphone-selection tests passed, including native capture without a competing WebView stream; a physical macOS call remains the authoritative route/volume smoke.
- README refreshed: yes, both `README.md` and `README.ru.md` describe `v0.4.7`, supported platforms, first-launch signing status, and current commands.

## Findings

- Blockers:
  - GitHub Release Preflight must pass on macOS, Windows, and Linux for the exact reviewed commit before `main` or `v0.4.7` can be published.
- Non-blocking issues:
  - This Windows workstation has no updater private key, so the local NSIS build completes but updater signing exits with the expected missing-key error. Repository secrets remain authoritative.
  - The optimized Windows Rust test harness compiles but cannot start because of a native model DLL entry-point mismatch. Production application/sidecar PE architecture checks pass, and clean GitHub runners remain the release gate.
  - Vite reports the existing mixed static/dynamic `SummaryModal` import and a main chunk above 500 kB; the production frontend build passes.
  - Rust reports existing unused call-capture/accessibility items and the debug LLM build reports an MSVC runtime warning; production Windows binaries still build and pass architecture verification.
  - Beads CLI (`bd`) and GitHub CLI (`gh`) are unavailable on this workstation; release state is recorded in this review and Git, and workflow status will be checked through the GitHub API.
- Follow-ups after release:
  - Reproduce and isolate the Windows release test-harness DLL entry-point mismatch without changing the production CRT contract.
  - Run physical Windows local-STT dictation and sleep/monitor-reconnect smokes against the published candidate.
  - Run a physical macOS call plus update/permission smoke while releases remain ad-hoc signed.

## Decision

- Ready for `main` merge: no, pending exact-commit release preflight.
- Release preflight green on exact tag commit: no, pending.
- Ready for tag publish: no, pending release preflight and final review update.
