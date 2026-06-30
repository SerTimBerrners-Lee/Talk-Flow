# Release Review v0.3.3

## Release

- Version: 0.3.3
- Release branch: release/v0.3.3
- Target tag: v0.3.3
- Reviewer: Codex
- Date: 2026-06-30

## Scope

- Key changes included in this release:
  - Stop showing the native macOS Accessibility prompt automatically during app startup.
  - Persist successful macOS system-audio permission probing so onboarding does not reset to `unknown` after restart.
  - Include system-audio permission in the startup onboarding gate on macOS.
  - Reset the persisted system-audio flag only after permission-related call-capture failures.
  - Refresh README permission and call-recording behavior notes.
- User-facing changes:
  - Talkis should not ask for the same permissions again on every launch after the user has completed onboarding.
  - If a permission is later denied or reset by the OS, Talkis asks again when that access is needed.
- Risky areas:
  - macOS onboarding permission state.
  - Call-capture startup and system-audio permission probing.

## Checks run

- `bunx tsc --noEmit`: passed during implementation.
- `cargo check`: passed during implementation.
- `git diff --check`: passed during implementation.
- `bun run check:release`: passed.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=$HOME/.tauri/talkis-updater.key bun run build:release:macos`: app, DMG, and updater archive were built outside the sandbox; local updater signing then failed because the password-protected updater key needs `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Native/GitHub Windows build: pending GitHub Actions after tag publish.
- Native/GitHub Linux build: pending GitHub Actions after tag publish.
- Additional manual checks:
  - Reviewed the release diff for permission lifecycle, version consistency, and README accuracy.

## Manual review

- Hotkey flow: not intentionally changed; covered by `bun run check:release` smoke tests.
- Onboarding permissions: reviewed startup gate and stored permission flags.
- Widget position and notice behavior: not intentionally changed.
- Transcription quality and short-utterance handling: not intentionally changed.
- README refreshed: yes.

## Findings

- Blockers: none.
- Non-blocking issues:
  - Local macOS updater signing is not possible in this shell without `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; GitHub Actions is expected to sign release artifacts from repository secrets.
- Follow-ups after release:
  - Verify the `v0.3.3` GitHub Actions release run publishes `latest.json`, macOS, Windows, and Linux artifacts with matching `.sig` files.

## Decision

- Ready for `main` merge: yes
- Ready for tag publish: yes
