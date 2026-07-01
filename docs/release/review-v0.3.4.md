# Release Review v0.3.4

## Release

- Version: 0.3.4
- Release branch: release/v0.3.4
- Target tag: v0.3.4
- Reviewer: Codex
- Date: 2026-07-01

## Scope

- Key changes included in this release:
  - Prevent startup permission checks from triggering native microphone prompts.
  - Stop resetting macOS Accessibility before opening the permission prompt.
  - Keep completed onboarding valid when microphone status is unknown rather than explicitly denied.
  - Replace the all-time words metric with words today in the transcription statistics card.
  - Add daily word buckets alongside existing monthly and all-time counters.
  - Refresh README release notes for v0.3.4.
- User-facing changes:
  - Talkis should not ask for already granted permissions again after a computer restart.
  - The main statistics card now shows words today, words this month, and words per minute.
- Risky areas:
  - macOS onboarding permission state after app/computer restart.
  - Migration of persisted transcription statistics from version 1 to version 2.

## Checks run

- `bun test src/lib/statsCore.test.ts`: passed during implementation.
- `bunx tsc --noEmit`: passed during implementation.
- `bun run check:release`: passed.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=$HOME/.tauri/talkis-updater.key bun run build:release:macos`: app, DMG, and updater archive were built outside the sandbox; local updater signing then failed because the password-protected updater key needs `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Native/GitHub Windows build: pending GitHub Actions after tag publish.
- Native/GitHub Linux build: pending GitHub Actions after tag publish.
- Additional manual checks:
  - Reviewed release diff for version consistency, README accuracy, permission lifecycle, and stats migration behavior.

## Manual review

- Hotkey flow: not intentionally changed; covered by release checks.
- Onboarding permissions: reviewed startup gate and explicit request paths.
- Widget position and notice behavior: not intentionally changed.
- Transcription quality and short-utterance handling: not intentionally changed.
- README refreshed: yes.

## Findings

- Blockers: none.
- Non-blocking issues:
  - Local macOS updater signing is not possible in this shell without `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; GitHub Actions is expected to sign release artifacts from repository secrets.
- Follow-ups after release:
  - Verify the `v0.3.4` GitHub Actions release run publishes `latest.json`, macOS, Windows, and Linux artifacts with matching `.sig` files.

## Decision

- Ready for `main` merge: yes
- Ready for tag publish: yes
