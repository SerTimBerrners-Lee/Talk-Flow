# Release Review v0.3.11

## Release

- Version: 0.3.11
- Release branch: release/v0.3.11
- Target tag: v0.3.11
- Reviewer: Codex
- Date: 2026-07-13

## Scope

- Key changes included in this release:
  - Re-publishes the v0.3.8-v0.3.10 app changes after the v0.3.10 Windows release job identified the remaining failure stage.
  - Removes the duplicate `Prepare release sidecars` step from the release workflow. The `Run release checks` step already prepares release sidecars with `TALKIS_STT_RELEASE=1`, and the bundle step reuses those files.
  - Makes `prepare-ffmpeg-sidecar.mjs` and `prepare-stt-sidecar.mjs` idempotent by skipping the copy when source and destination binaries are already identical.
  - Updates release versions and README release notes for v0.3.11.
- User-facing changes:
  - No new app behavior beyond v0.3.8.
  - Windows release publishing should no longer fail on a repeated sidecar preparation pass.
- Risky areas:
  - GitHub Actions release workflow sequencing after relying on sidecars prepared during release checks.
  - Sidecar copy idempotency and hash comparison for repeated local/CI runs.
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
- GitHub v0.3.10 release run:
  - macOS build: passed.
  - Windows build: passed `Run release checks`, failed `Prepare release sidecars`.
  - Linux build: was still in progress when the Windows duplicate-prepare failure was identified.
- Native/GitHub Windows build: delegated to GitHub Actions release workflow for v0.3.11.
- Native/GitHub Linux build: delegated to GitHub Actions release workflow for v0.3.11.
- Additional manual checks:
  - Confirmed release run `29248343011` for v0.3.10 exposed the Windows failure stage after splitting workflow steps.
  - Confirmed local repeated sidecar preparation still passes after adding copy idempotency.

## Manual review

- Hotkey flow: hotkey FSM smoke tests passed.
- Onboarding permissions: no onboarding permission surface changed in this release.
- Widget position and notice behavior: no app UI behavior changed in this hotfix.
- Transcription quality and short-utterance handling: no STT behavior changed in this hotfix.
- README refreshed: yes, README and README.ru document v0.3.11.

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
  - Repair the local Beads Dolt journal before the next tracked task session.

## Decision

- Ready for `main` merge: yes.
- Ready for tag publish: yes, with the signing-secret caveat above.
