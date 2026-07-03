# Release Review v0.3.7

## Release

- Version: 0.3.7
- Release branch: release/v0.3.7
- Target tag: v0.3.7
- Reviewer: Codex
- Date: 2026-07-03

## Scope

- Key changes included in this release:
  - Migrated managed local STT to one native `transcribe.cpp` runtime for Whisper, Qwen ASR, and NVIDIA Parakeet.
  - Removed old Qwen/Parakeet MLX/Python sidecars, manifests, and runtime engine files from the app bundle path.
  - Migrated legacy local STT endpoints `8001` and `8002` to the unified `8000` runtime.
  - Fixed local STT file-transcription errors so local runtime failures do not show API-key authorization copy.
  - Fixed local STT model selection so it no longer clears the selected text/LLM model used for summarization.
  - Kept `handy-keys` based hotkey registration and removed the old Tauri global-shortcut dependency.
- User-facing changes:
  - Local file transcription on installed local models is much faster through `transcribe.cpp`.
  - Qwen ASR and NVIDIA Parakeet now install as GGUF models under the unified local STT runtime.
  - Settings no longer expose separate Qwen/Parakeet runtime ports.
  - Summary warning copy no longer uses the long dash.
- Risky areas:
  - Local STT model download/install flow for fresh Qwen/Parakeet GGUF installs.
  - macOS Accessibility/hotkey behavior after switching to `handy-keys`.
  - Release updater signing depends on GitHub Actions secrets because the local updater key is encrypted.

## Checks run

- `git diff --check`: passed.
- `bun run check:release`: passed.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed without warnings after cleanup.
- `cargo test --manifest-path src-tauri/Cargo.toml --bin talkis-stt`: passed, 4 tests.
- `bun test src/lib/summarize.test.ts src/lib/fileTranscription.test.ts`: passed, 13 tests.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/talkis-updater.key bun run build:release:macos`: built release sidecars, frontend, `Talkis.app`, and `Talkis.app.tar.gz`; failed only at updater signature step because the local encrypted key password was not available in this shell.
- Native/GitHub Windows build: delegated to GitHub Actions release workflow.
- Native/GitHub Linux build: delegated to GitHub Actions release workflow.
- Additional manual checks:
  - Temporary `talkis-stt` runtime smoke test on port `18081`: `/health`, `/v1/models`, and silent local transcription passed.
  - User manually tested the faster local transcription path before release request.

## Manual review

- Hotkey flow: smoke tests passed for start, stop, lock, suppressed release, and reset states.
- Onboarding permissions: previous permission-onboarding changes are included; no new permission prompt changes in this release slice.
- Widget position and notice behavior: no release-blocking changes found in this review slice.
- Transcription quality and short-utterance handling: `talkis-stt` low-signal guard test passed; local runtime smoke test returned empty text for silence.
- README refreshed: yes, README and README.ru now document unified `transcribe.cpp` local STT runtime and v0.3.7 changes.

## Findings

- Blockers:
  - No code blocker found for main/tag.
  - Local macOS updater signing cannot complete without `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the encrypted local key. GitHub Actions must have `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` configured for the release to publish updater metadata.
- Non-blocking issues:
  - Vite reports the existing large chunk warning for the main JS bundle.
  - Local `gh` CLI auth is invalid, so the previous failed release run could not be inspected from this machine.
- Follow-ups after release:
  - Verify GitHub Actions release run for macOS, Windows, Linux, and `latest.json` publication.
  - If Actions fail at signing, refresh GitHub updater signing secrets before rerunning the workflow.

## Decision

- Ready for `main` merge: yes.
- Ready for tag publish: yes, with the signing-secret caveat above.
