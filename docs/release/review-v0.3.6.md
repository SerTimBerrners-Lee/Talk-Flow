# Release Review v0.3.6

## Release

- Version: 0.3.6
- Release branch: release/v0.3.6
- Target tag: v0.3.6
- Reviewer: Codex
- Date: 2026-07-02

## Scope

- Key changes included in this release:
  - Recover completed permissions onboarding for existing installs when required macOS permissions are already granted.
  - Replace Lucide icons with Phosphor icons through a local icon facade.
  - Add a Vite runner that copies the macOS esbuild binary to the system temp directory before dev/build, avoiding `write EPIPE` failures when the repo lives on an external drive.
  - Preserve the local-model API-key fix and widget notice alignment fix from the hotfix work.
- User-facing changes:
  - Updates should no longer reopen the full permissions screen for users who already granted microphone and Accessibility access.
  - Local STT mode should no longer surface API-key wording for local runtime failures.
  - Settings and widget UI use the softer Phosphor icon set.
  - `bun run tauri dev` works from `/Volumes/KINGSTON` without manual `ESBUILD_BINARY_PATH`.
- Risky areas:
  - Permissions onboarding recovery relies on existing history plus current OS permission checks.
  - Icon migration touches many UI imports, though through one facade.
  - Local macOS updater signing requires `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the local environment did not provide it.

## Checks run

- `bun run check:release`: passed.
- `bun run build:release:macos`: app bundle and updater tarball built, then failed at updater signing because the local environment did not provide the private-key password.
- Native/GitHub Windows build: pending GitHub Actions tag build.
- Native/GitHub Linux build: pending GitHub Actions tag build.
- Additional manual checks:
  - `bun run dev -- --host 127.0.0.1`: passed after the Vite/esbuild runner fix.
  - `bunx tsc --noEmit`: passed during icon rollback.
  - Verified `lucide-react`, `@tabler/icons-react`, and `@hugeicons/*` are absent from app dependencies and source.

## Manual review

- Hotkey flow: smoke test passed through `src/windows/widget/services/hotkeyFsm.test.js`.
- Onboarding permissions: reviewed startup gating in `SettingsApp`; system-audio permission is no longer required for the initial settings app gate, and existing installs with history can recover the completed flag.
- Widget position and notice behavior: reviewed notice icon facade usage and centered icon layout.
- Transcription quality and short-utterance handling: unchanged in this release.
- README refreshed: yes, `README.md` includes `v0.3.6` notes.

## Findings

- Blockers:
  - None for GitHub Actions release, assuming repository signing secrets include the updater private key password.
- Non-blocking issues:
  - Local `bun run build:release:macos` cannot complete updater signing without `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  - Production frontend bundle remains above the default Vite 500 kB warning threshold.
- Follow-ups after release:
  - Consider documenting the local updater signing password requirement for macOS release builds.
  - Consider code-splitting settings tabs or model assets to reduce the main frontend bundle size.

## Decision

- Ready for `main` merge: yes.
- Ready for tag publish: yes, with GitHub Actions signing secrets expected to complete updater signing.
