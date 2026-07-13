# Release Review v0.3.9

## Release

- Version: 0.3.9
- Release branch: release/v0.3.9
- Target tag: v0.3.9
- Reviewer: Codex
- Date: 2026-07-13

## Scope

- Key changes included in this release:
  - Re-publishes the v0.3.8 app changes after fixing the Windows release build regression.
  - Fixes `scripts/run-vite.mjs` on Windows by resolving the script path with `fileURLToPath(import.meta.url)` instead of `new URL(import.meta.url).pathname`.
  - Updates release versions and README release notes for v0.3.9.
- User-facing changes:
  - No new app behavior beyond v0.3.8.
  - GitHub Actions should be able to produce the Windows installer again.
- Risky areas:
  - Windows release build path handling in the Vite wrapper.
  - Release updater signing still depends on valid GitHub Actions secrets.

## Checks run

- `git diff --check`: passed.
- `bun run check:versions`: passed for `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- GitHub CI on hotfix commit `4e68215`: passed.
  - `tsc + hotkey smoke`: passed.
  - `cargo check (macos)`: passed.
  - `cargo check (windows)`: passed.
  - `cargo check (linux)`: passed.
- `bun run check:release`: passed.
  - Sidecar preparation passed for ffmpeg, `talkis-stt`, `talkis-diarize`, and `talkis-llm`.
  - `bunx tsc --noEmit` passed.
  - `cargo check --manifest-path src-tauri/Cargo.toml` passed.
  - Hotkey FSM smoke tests passed.
  - Vite production build passed with the existing warnings for `SummaryModal.tsx` mixed static/dynamic import and a large main chunk.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key bun run build:release:macos`: built release sidecars, frontend, Rust release binary, `Talkis.app`, and `Talkis.app.tar.gz`; failed only at updater signature because this shell does not have the correct `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the encrypted local key.
- Native/GitHub Windows build: delegated to GitHub Actions release workflow.
- Native/GitHub Linux build: delegated to GitHub Actions release workflow.
- Additional manual checks:
  - Confirmed failed release runs v0.3.6-v0.3.8 all failed only in `Build windows`, while macOS and Linux succeeded.
  - Confirmed the first failing release was v0.3.6, where `scripts/run-vite.mjs` was introduced.

## Manual review

- Hotkey flow: hotkey FSM smoke tests and GitHub CI passed.
- Onboarding permissions: no new onboarding permission surface was introduced in this release.
- Widget position and notice behavior: no app UI behavior changed in this hotfix.
- Transcription quality and short-utterance handling: no STT behavior changed in this hotfix.
- README refreshed: yes, README and README.ru document v0.3.9.

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
  - If Actions fail at signing, refresh `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in repository secrets and rerun the release workflow.
  - Repair the local Beads Dolt journal before the next tracked task session.

## Decision

- Ready for `main` merge: yes.
- Ready for tag publish: yes, with the signing-secret caveat above.
