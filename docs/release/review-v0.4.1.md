# Release Review v0.4.1

## Release

- Version: 0.4.1
- Release branch: `release/v0.4.1`
- Target tag: `v0.4.1`
- Reviewer: Codex
- Date: 2026-07-20

## Scope

- Key changes included in this release:
  - Adds GigaAM v3 E2E RNNT as a managed local Russian STT model backed by the unified `transcribe.cpp` runtime.
  - Limits GigaAM file-transcription chunks to 25 seconds and keeps already compatible short WAV files on the direct local path.
  - Fixes local selected-text translation dropping later sentences by translating sentence units as one checked CTranslate2 batch.
  - Retries local STT model downloads after transient Hugging Face transport errors with bounded backoff.
  - Keeps a newly installed local model in the installed UI state while the managed runtime refreshes.
  - Streams microphone and system-audio call transcripts into the Transcription result view, persists transcript checkpoints, and keeps saved audio as the recovery source.
  - Adds a persistent desktop tray with explicit open and full-process quit actions.
  - Adds Windows x86-64 PE validation for the application and every bundled sidecar before release artifacts can pass preflight.
- User-facing changes:
  - GigaAM can be installed, selected, and removed from the local-model settings.
  - Multi-sentence selected text is translated completely instead of stopping after the first sentence.
  - Temporary download connection failures are retried automatically.
  - The model card no longer briefly returns to the download state after a successful installation.
  - Call text appears during recording instead of only after the call ends; recording and processing badges were removed in favor of the existing stop action.
  - Talkis remains accessible from the system tray, and the user can fully exit without Task Manager.
- Risky areas:
  - Local STT model catalog consistency between the React UI, Tauri commands, and the bundled `talkis-stt` sidecar.
  - Media probing and short-window file chunking for GigaAM.
  - Sentence-boundary handling and result ordering in local CTranslate2 translation.
  - Large-model downloads, cancellation, retry timing, and installed-state refreshes.
  - Dual-channel live call transcription, durable checkpoints, crash recovery, and final stop-time refinement.
  - Windows executable architecture, tray availability, and managed sidecar shutdown.
  - Cross-platform bundle generation and updater signing.

## Checks run

- `git diff --check`: passed.
- Secret-pattern scan of changed source and documentation: passed; no credential-like values found.
- `bash scripts/check-version-sync.sh`: passed at `0.4.1`.
- `bunx tsc --noEmit`: passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- Focused frontend tests for live call transcript assembly, managed runtime endpoint selection, streaming eligibility, and hotkey behavior: passed, `16/16`.
- `bun run check:release`: passed.
  - Release inputs and versions passed.
  - Sidecar preparation passed.
  - TypeScript and `cargo check` passed.
  - Hotkey smoke tests passed, `6/6`.
  - Vite production build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: passed, `107/107` active tests; one installed-model NLLB test is ignored by default.
- `cargo test --manifest-path src-tauri/Cargo.toml --bin talkis-stt`: passed, `15/15`.
- Focused tray and shutdown tests: passed, `2/2`.
- Windows PE release verifier self-test: passed.
- Published v0.4.0 Windows installer metadata:
  - GitHub asset size is 29,571,112 bytes and its published SHA-256 is `6262b2bc3991e4d5d8193a1d20bb66c073cdc5bb49859d7f072a6ba5649530e6`.
  - The NSIS installer stub has a valid x86 PE header, which is supported on 64-bit Windows. The v0.4.1 pipeline now separately enforces x86-64 for the application payload and all sidecars.
- Installed NLLB integration test for the reported two-sentence English phrase: passed, `1/1`; both the sick-leave sentence and the following morning sentence were translated.
- Managed `talkis-stt` health endpoint after sidecar preparation: passed at `http://127.0.0.1:8000/health`.
- `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/trixter/.tauri/talkis-updater.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' bun run build:release:macos`:
  - Passed end to end after normalizing the signing environment so the Tauri signer receives one private-key source instead of conflicting key and key-path arguments. The direct path-only postprocess flow also passed after the release review fix.
  - Release sidecars, frontend, Rust binary, `Talkis.app`, updater `.app.tar.gz`, updater signature, and `Talkis_0.4.1_aarch64.dmg` were rebuilt successfully.
  - All `tauri dev` and managed runtime processes were stopped before the successful clean release build to avoid the known shared-staging race.
  - macOS postprocessing now recreates and signs the updater archive after applying the stable ad-hoc application identifier. The app extracted from `.app.tar.gz` passes strict `codesign` verification with `Identifier=com.trixter.talkis`.
  - `hdiutil verify` reports the final DMG checksum as valid.
  - Final SHA-256: DMG `0a9b0732997b711e3510e987454f24aa42d83285e4ef5c25569ca1d337b96d40`; updater archive `ee5abff3291dc7f8618510cf3472fe6abc184f2a5f63f8a311887148c604fa4c`.
  - GitHub preflight and release workflows now pass updater signing credentials to the macOS postprocess step.
  - GitHub preflight and release workflows now run the Windows x64 architecture verifier after bundling; the published stable Windows installer also receives a `.sha256` file.
- GitHub Release Preflight run `29779118499` on commit `8e2a40a`: Linux and macOS passed; Windows failed at the new PE architecture gate because `talkis-stt.exe` was still a placeholder after its static-CRT link failed.
  - The gate prevented the invalid Windows payload from being published.
  - The corrective patch aligns transcribe.cpp's MSVC runtime with Rust/CTranslate2 `/MT`, removes placeholders after failed sidecar builds, and runs release checks through one fail-fast command so PowerShell cannot mask an earlier native-command failure.
- Exact-commit Release Preflight after the Windows corrective patch: pending.
- Additional manual checks:
  - The exact reported multi-sentence translation regression was reproduced as an installed-model integration test and now passes.
  - The configured GigaAM GGUF URL responds and reports the expected 183,948,704-byte artifact.
  - A 20-second saved WAV probe against the prepared managed local runtime produced `started` and `partial` live events before the stream was stopped.

## Manual review

- Hotkey flow: no hotkey behavior changed; automated smoke tests pass, `6/6`. No new manual hotkey session was run for this patch.
- Onboarding permissions: unchanged in this patch and not manually rerun.
- Widget position and notice layout: no positioning behavior changed. The call-capture path now starts dual-channel live STT, emits current text into the existing result surface, and persists five-second draft checkpoints; focused tests and a local live endpoint probe pass.
- Transcription quality and short-utterance handling: existing hallucination filters remain unchanged; GigaAM routing, aliases, non-streaming mode, and 25-second file window have focused passing tests.
- README refreshed: yes, `README.md` and `README.ru.md` document v0.4.1 and GigaAM runtime support.

## Findings

- Blockers:
  - Require green `Preflight macos`, `Preflight windows`, and `Preflight linux` checks on the exact corrected release commit before merging or tagging.
- Accepted release risk:
  - The existing P1 cloud-recognition incident `talkis-pc-5vt` remains open: realtime returns HTTP 400 and batch currently reaches a cloud-billing 503. The user explicitly accepted this known risk for `v0.4.1`; the release does not claim a cloud-STT fix.
- Non-blocking issues:
  - Vite reports an approximately 850 kB main chunk and the existing mixed static/dynamic `SummaryModal.tsx` import warning.
  - Local release assembly can still race with an active `tauri dev` process over shared sidecar staging; release builds must run after the dev process is stopped until `talkis-pc-6i2` is resolved.
  - Bun 1.2.13 full-suite auto-discovery intermittently returns `ProcessFdQuotaExceeded` on the removable-volume workspace. The same focused files pass when invoked directly, and the mandatory release smoke suite passes.
- Follow-ups after release:
  - Prevent local release assembly from sharing mutable sidecar staging with an active `tauri dev` process.
  - Split the main frontend bundle and remove the mixed `SummaryModal` import mode.

## Decision

- Ready for `main` merge: no.
- Release preflight green on exact tag commit: no.
- Ready for tag publish: no.
