# Release Review v0.3.10

## Release

- Version: 0.3.10
- Release branch: release/v0.3.10
- Target tag: v0.3.10
- Reviewer: Codex
- Date: 2026-07-13

## Scope

- Key changes included in this release:
  - Re-publishes the v0.3.8/v0.3.9 app changes after the v0.3.9 Windows release job still failed in `Build bundles`.
  - Hardens Windows path normalization in `scripts/run-vite.mjs` for Bun/Windows path shapes that may still include a leading slash before a drive letter.
  - Splits the GitHub Actions release bundle phase into explicit `Prepare release sidecars`, `Build frontend`, `Build bundles`, and macOS postprocess steps so a future Windows failure identifies the exact substage without raw log access.
  - Updates release versions and README release notes for v0.3.10.
- User-facing changes:
  - No new app behavior beyond v0.3.8.
  - Release publishing should either produce all native artifacts or expose the precise remaining Windows packaging stage.
- Risky areas:
  - Windows release path handling in the Vite wrapper.
  - GitHub Actions release workflow sequencing after replacing the single `build-release.mjs` step with equivalent explicit steps.
  - Release updater signing still depends on valid GitHub Actions secrets.

## Checks run

- `git diff --check`: passed.
- `bun run check:versions`: passed for `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- `bun run check:release`: passed.
  - Sidecar preparation passed for ffmpeg, `talkis-stt`, `talkis-diarize`, and `talkis-llm`.
  - `bunx tsc --noEmit` passed.
  - `cargo check --manifest-path src-tauri/Cargo.toml` passed.
  - Hotkey FSM smoke tests passed.
  - Vite production build passed with the existing warnings for `SummaryModal.tsx` mixed static/dynamic import and a large main chunk.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key bun run build:release:macos`: built release sidecars, frontend, Rust release binary, `Talkis.app`, and `Talkis.app.tar.gz`; failed only at updater signature because this shell does not have the correct `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the encrypted local key.
- GitHub v0.3.9 release run:
  - macOS build: passed and uploaded artifact.
  - Linux build: passed and uploaded artifact.
  - Windows build: passed `Run release checks`, failed `Build bundles`; raw logs require repository admin/auth, so the exact command inside the old combined step was not visible.
- Native/GitHub Windows build: delegated to GitHub Actions release workflow for v0.3.10.
- Native/GitHub Linux build: delegated to GitHub Actions release workflow for v0.3.10.
- Additional manual checks:
  - Confirmed release run `29245642487` for v0.3.9 failed only on Windows after macOS/Linux succeeded.
  - Confirmed GitHub public job HTML exposes per-step status and `data-log-url`, but raw step logs still require authentication.

## Manual review

- Hotkey flow: hotkey FSM smoke tests passed.
- Onboarding permissions: no onboarding permission surface changed in this release.
- Widget position and notice behavior: no app UI behavior changed in this hotfix.
- Transcription quality and short-utterance handling: no STT behavior changed in this hotfix.
- README refreshed: yes, README and README.ru document v0.3.10.

## Findings

- Blockers:
  - No code blocker found for main/tag.
  - Local updater signing cannot complete without the encrypted updater key password in this shell. GitHub Actions must have valid `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets for final updater signatures and `latest.json`.
- Non-blocking issues:
  - Vite still reports the existing large main chunk warning.
  - Vite still reports that `SummaryModal.tsx` is both dynamically and statically imported, so that dynamic import is not split into a separate chunk.
  - Beads local Dolt server is unavailable because the local journal is corrupted, so issue tracker status could not be updated locally.
- Follow-ups after release:
  - Verify the GitHub Actions release run for macOS, Windows, Linux, updater signatures, and `latest.json`.
  - If v0.3.10 still fails on Windows, use the split step status to fix the exact remaining stage and publish the next patch tag.
  - Repair the local Beads Dolt journal before the next tracked task session.

## Decision

- Ready for `main` merge: yes.
- Ready for tag publish: yes, with the signing-secret caveat above.
