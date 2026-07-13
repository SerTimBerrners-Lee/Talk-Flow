# Release Review v0.3.12

## Release

- Version: 0.3.12
- Release branch: release/v0.3.12
- Target tag: v0.3.12
- Reviewer: Codex
- Date: 2026-07-13

## Scope

- Key changes included in this release:
  - Re-publishes the v0.3.8-v0.3.11 app changes after v0.3.11 identified the remaining Windows failure stage as `Build frontend`.
  - Fixes `scripts/run-vite.mjs` to invoke Vite through `vite/bin/vite.js` with the current runtime instead of the Windows `.cmd` shim.
  - Aligns Windows release builds with `ct2rs`/CTranslate2 by using `RUSTFLAGS=-C target-feature=+crt-static` in Release and Release Preflight matrix jobs.
  - Uses the new Release Preflight gate before any tag is created.
  - Updates release versions and README release notes for v0.3.12.
- User-facing changes:
  - No new app behavior beyond v0.3.8.
  - Windows release publishing should no longer fail in frontend build because of the Vite shim path.
  - Windows release publishing should no longer fail while linking the bundled C++ translation runtime.
- Risky areas:
  - Cross-platform Vite wrapper execution through `process.execPath`.
  - Windows static MSVC CRT release linking for C++ translation dependencies.
  - Release preflight must be green on macOS, Windows, and Linux before tag publish.
  - Release updater signing still depends on valid GitHub Actions secrets.

## Checks run

- `git diff --check`: passed.
- `bun run check:versions`: passed for `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- `bun run check:release`: passed.
  - Sidecar preparation passed for ffmpeg, `talkis-stt`, `talkis-diarize`, and `talkis-llm`.
  - `bunx tsc --noEmit` passed.
  - `cargo check --manifest-path src-tauri/Cargo.toml` passed.
  - Hotkey FSM smoke tests passed.
  - Vite production build passed with warnings for Bun's emulated Node version, `SummaryModal.tsx` mixed static/dynamic import, and a large main chunk.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key bun run build:release:macos`: built release sidecars, frontend, Rust release binary, `Talkis.app`, and `Talkis.app.tar.gz`; failed only at updater signature because this shell does not have the correct `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the encrypted local key.
- GitHub Release Preflight: must be green for `Preflight macos`, `Preflight windows`, and `Preflight linux` on the final release commit before `main` merge and tag push.
  - First preflight run `29252319785` on commit `5aa28f5` passed macOS and Linux, passed Windows `Run release checks` and `Build frontend`, then failed Windows `Build bundles` with MSVC CRT mismatch around `libct2rs`.
  - Second preflight run `29254503310` on commit `8b07413` passed macOS, Linux, and Windows; Windows passed `Build bundles` after adding Windows `RUSTFLAGS=-C target-feature=+crt-static`.
  - This review update changes the release commit, so a final preflight run is still required on the exact commit that will be merged and tagged. Do not edit release files after that final green run.
- Native/GitHub Windows build: passed in Release Preflight run `29254503310`; must pass once more on the final release commit.
- Native/GitHub Linux build: passed in Release Preflight run `29254503310`; must pass once more on the final release commit.
- Additional manual checks:
  - Confirmed release run `29250361300` for v0.3.11 failed at Windows `Build frontend` after Windows `Run release checks` succeeded.

## Manual review

- Hotkey flow: hotkey FSM smoke tests passed.
- Onboarding permissions: no onboarding permission surface changed in this release.
- Widget position and notice behavior: no app UI behavior changed in this hotfix.
- Transcription quality and short-utterance handling: no STT behavior changed in this hotfix.
- README refreshed: yes, README and README.ru document v0.3.12.

## Findings

- Blockers:
  - Tag publish is blocked until the final Release Preflight is green for macOS, Windows, and Linux on the exact release commit.
  - Local updater signing may still require the encrypted updater key password in this shell. GitHub Actions must have valid `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets for final updater signatures and `latest.json`.
- Non-blocking issues:
  - Vite still reports the existing large main chunk warning.
  - Vite still reports that `SummaryModal.tsx` is both dynamically and statically imported, so that dynamic import is not split into a separate chunk.
  - Beads local Dolt server is unavailable because the local journal is corrupted, so issue tracker status could not be updated locally.
- Follow-ups after release:
  - Verify the GitHub Actions release run for macOS, Windows, Linux, updater signatures, and `latest.json` only after preflight passes and tag is pushed.
  - Repair the local Beads Dolt journal before the next tracked task session.

## Decision

- Ready for `main` merge: yes after the final Release Preflight is green on this commit.
- Release preflight green on exact tag commit: pending final Release Preflight on this commit.
- Ready for tag publish: yes after the final Release Preflight is green on this commit.
