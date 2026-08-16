# Release Review v0.4.6

## Release

- Version: 0.4.6
- Release branch: `release/v0.4.6`
- Target tag: `v0.4.6`
- Reviewer: Codex
- Date: 2026-08-16

## Scope

- Key changes included in this release:
  - Replaces the short-lived native dictation thread created for every recording with one process-long `talkis-native-voice-owner` thread.
  - Performs the first Windows WASAPI input-device lookup on that owner during application setup and keeps the owning COM apartment alive for the process lifetime.
  - Creates, holds, starts, stops, and drops each `cpal::Stream` on the same owner thread, with `Start` and `Stop` commands sent through channels.
  - Converts recoverable Rust panics during native stream startup or teardown into recorder errors so the existing WebView microphone fallback remains available.
  - Adds structured native-recorder lifecycle logs, an owner-thread regression test, and the corresponding audio-pipeline contract.
  - Updates the desktop version and English/Russian release notes for `v0.4.6`.
- User-facing changes:
  - Prevents the Windows process from closing without an error on the first dictation after a long idle period or system sleep due to a stale `cpal` WASAPI COM enumerator.
  - Keeps normal dictation recoverable when native microphone capture returns an ordinary error by preserving the existing WebView fallback path.
- Risky areas:
  - Windows WASAPI/COM thread ownership and initialization order.
  - Cross-platform `cpal::Stream` lifetime, especially the existing macOS non-`Send` constraint.
  - Native recorder start/stop serialization and live-dictation session cleanup.

## Checks run

- `bun test`: passed, `253/253` tests across 33 files.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `CARGO_INCREMENTAL=0 bun run check:release`: passed after removing an obsolete 5 GB temporary Rust target that had filled the local system volume; includes synchronized version `0.4.6`, sidecar preparation, TypeScript/Rust checks, hotkey smoke `6/6`, and the production frontend build.
- `CARGO_INCREMENTAL=0 cargo test --release --manifest-path src-tauri/Cargo.toml --lib`: passed, `109` tests passed and `1` model-dependent test ignored; includes `sequential_commands_reuse_one_long_lived_owner_thread`.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key CARGO_INCREMENTAL=0 bun run build:release:macos`: compiled the optimized application and all release sidecars and produced `Talkis.app` plus the updater archive; final updater signing could not decrypt the local password-protected key because its password is unavailable in this shell.
- Built `Talkis.app` version: verified as `0.4.6` from `CFBundleShortVersionString`.
- `codesign --force --deep --sign - --identifier com.trixter.talkis` followed by `codesign --verify --deep --strict`: passed for the locally built application and all four sidecars; every executable was verified as arm64 Mach-O.
- Initial GitHub Release Preflight for preparation commit `b920c68`: passed in [run 31968406938](https://github.com/SerTimBerrners-Lee/talkis/actions/runs/31968406938).
- Native/GitHub macOS build: passed in `15m46s`; signed updater post-processing, app archive, and artifact upload completed.
- Native/GitHub Windows x64 build: passed in `28m1s`; release checks, NSIS bundle, x64 architecture verification, updater signature, and artifact upload completed.
- Native/GitHub Linux build: passed in `18m33s`; AppImage/deb bundle creation, updater signature, and artifact upload completed.
- GitHub Release Preflight for reviewed commit `d4c4545`: passed in [run 31969845170](https://github.com/SerTimBerrners-Lee/talkis/actions/runs/31969845170).
- Exact-review macOS build: passed in `6m36s`.
- Exact-review Windows x64 build: passed in `9m25s`, including architecture verification.
- Exact-review Linux build: passed in `6m26s`.
- Additional review checks:
  - Full diff from `v0.4.5` reviewed file by file; no unintended binary or generated-file changes are included.
  - Version sync passed for `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and both Talkis workspace entries in `Cargo.lock`.
  - `.github/workflows/release-preflight.yml` and `.github/workflows/release.yml` were reviewed and remain unchanged; the tag workflow still requires successful `Preflight macos`, `Preflight windows`, and `Preflight linux` checks on the tagged SHA.

## Manual review

- Hotkey flow: unchanged; mandatory hotkey FSM smoke passed `6/6`, and the complete frontend suite passed.
- Onboarding permissions: unchanged; native recorder warm-up does not request microphone permission or start a stream.
- Widget position and notice behavior: unchanged.
- Transcription quality and short-utterance handling: unchanged; the release modifies native capture ownership, not sample conversion, no-speech filtering, cleanup, or paste behavior.
- Recorder lifecycle: all ordinary dictation `cpal` device and stream operations are now serialized through one process-long owner; start response loss cancels the live session and drops the stream on that owner.
- README refreshed: yes, both `README.md` and `README.ru.md` describe the Windows stability fix in `v0.4.6`.

## Findings

- Blockers:
  - None identified.
- Non-blocking issues:
  - The local updater key is password-protected and its password is unavailable in this shell, so repository secrets in exact-commit preflight remain the authoritative updater-signing check.
  - A real Windows 10 repeated start/stop plus 30-minute idle or sleep/resume smoke is still required to close `talkis-pc-9p9`; preflight verifies native compilation, packaging, signing, and Windows x64 architecture but cannot reproduce physical audio-device suspend/resume behavior.
  - Vite reports the existing mixed static/dynamic `SummaryModal` import and a main chunk above 500 kB; the production build still passes.
  - GitHub Actions reports the existing Node.js 20 deprecation warning for `actions/checkout`, `actions/cache`, and `actions/upload-artifact` while forcing them to Node.js 24.
- Follow-ups after release:
  - Run the Windows 10 idle and sleep/resume smoke and close `talkis-pc-9p9` when runtime evidence is clean.
  - Audit and centralize the other Windows `cpal`/WASAPI paths for call capture and live translation under `talkis-pc-gw5`.
  - Restore a secure local copy of the active updater-key password if fully signed local updater builds are required.

## Decision

- Ready for `main` merge: yes, after this final review-only commit repeats exact-commit preflight successfully.
- Release preflight green on reviewed release commit: yes, run `31969845170` for `d4c4545`.
- Ready for tag publish: yes, after the final review-only commit repeats exact-commit preflight successfully.
