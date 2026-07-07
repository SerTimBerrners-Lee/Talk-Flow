# Release Review v0.3.8

## Release

- Version: 0.3.8
- Release branch: release/v0.3.8
- Target tag: v0.3.8
- Reviewer: Codex
- Date: 2026-07-07

## Scope

- Key changes included in this release:
  - Added live local dictation for local streaming STT models with a text overlay that appears at recording start and updates from partial/final events.
  - Added native live dictation audio feeding, pause/resume handling, final text handoff, and fallback to the existing full-audio transcription path.
  - Added local STT streaming/live endpoints in `talkis-stt` with NDJSON `started`, `partial`, `final`, and `error` events.
  - Improved text overlay lifecycle for live dictation, selected-text translation, insertion state, paste failure, and first-show startup races.
  - Added local selected-text translation flow, local translator runtime support, translation hotkey settings, and dev-chat translation affordances.
  - Improved local file transcription for WebM/video inputs and local streaming models.
  - Reduced history memory pressure by storing retained recording audio through the history audio store rather than large inline payloads.
  - Refreshed model/settings UI and removed unused adapter image assets.
- User-facing changes:
  - Local streaming STT models can show speech text while the user is still recording.
  - Overlay labels now distinguish listening, translation, insertion, and error states.
  - Failed paste leaves final text visible for copying instead of hiding the overlay.
  - Selected text can be translated through local translator/LLM flows.
  - Local file transcription handles WebM/video inputs more reliably with local streaming models.
- Risky areas:
  - Native live recorder audio fan-out into live ASR sessions.
  - `talkis-stt` live/streaming HTTP protocol and model-specific streaming options.
  - Overlay window ordering, cached payload handoff, and conflict prevention between dictation and translation overlays.
  - Local translator sidecar dependency footprint and release packaging.
  - Release updater signing depends on GitHub Actions secrets because the local updater key is encrypted.

## Checks run

- `git diff --check`: passed.
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`: passed.
- `bun run check:release`: passed.
  - Version sync passed for `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
  - Sidecar preparation passed for ffmpeg, `talkis-stt`, `talkis-diarize`, and `talkis-llm`.
  - `bunx tsc --noEmit` passed.
  - `cargo check --manifest-path src-tauri/Cargo.toml` passed.
  - Hotkey FSM smoke tests passed.
  - Vite production build passed with existing warnings for `SummaryModal.tsx` mixed static/dynamic import and a large main chunk.
- `bun test src/windows/widget/services/dictationStreamOverlay.test.ts src/windows/widget/services/selectionTranslation.test.ts src/lib/fileTranscription.test.ts src/lib/historyAudioRetention.test.ts src/lib/hotkeyValidation.test.ts src/windows/widget/hooks/useWidgetHotkey.test.ts`: passed, 64 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml streaming`: passed, 9 relevant tests.
- `cargo test --manifest-path src-tauri/Cargo.toml live_`: passed, 4 relevant tests.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key bun run build:release:macos`: built release sidecars, frontend, Rust release binary, `Talkis.app`, and `Talkis.app.tar.gz`; failed only at updater signature because this shell does not have `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the encrypted local key.
- Native/GitHub Windows build: delegated to GitHub Actions release workflow.
- Native/GitHub Linux build: delegated to GitHub Actions release workflow.
- Additional manual checks:
  - User exercised live overlay, translation overlay, local model selection, and local WebM transcription during the release stabilization cycle.
  - No fresh manual UI smoke was run from this non-interactive shell after the final release build attempt.

## Manual review

- Hotkey flow: hotkey FSM smoke tests and selection hotkey tests passed.
- Onboarding permissions: no new onboarding permission surface was introduced in this release.
- Widget position and notice behavior: reviewed overlay sizing/handshake/conflict changes; no release-blocking issue found.
- Transcription quality and short-utterance handling: streaming/live unit tests passed; existing full-audio fallback remains in place for live-ASR failures.
- README refreshed: yes, README documents v0.3.8 changes.

## Findings

- Blockers:
  - No code blocker found for main/tag.
  - Local macOS updater signing cannot complete without `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the encrypted local key. GitHub Actions must have valid `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets for final updater signatures and `latest.json`.
- Non-blocking issues:
  - Vite still reports the existing large main chunk warning.
  - Vite still reports that `SummaryModal.tsx` is both dynamically and statically imported, so that dynamic import is not split into a separate chunk.
  - Beads local Dolt server was unavailable in this shell, so issue tracker status could not be updated locally.
- Follow-ups after release:
  - Verify the GitHub Actions release run for macOS, Windows, Linux, updater signatures, and `latest.json`.
  - If Actions fail at signing, refresh `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in repository secrets and rerun the release workflow.
  - Consider making local updater signing fail earlier with a clearer message when the local encrypted key password is missing.

## Decision

- Ready for `main` merge: yes.
- Ready for tag publish: yes, with the signing-secret caveat above.
