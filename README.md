<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" height="96" alt="Talkis app icon">
</p>

<h1 align="center">Talkis</h1>

<p align="center">
  Open desktop voice input for people who write in real apps all day.
</p>

<p align="center">
  <a href="README.ru.md">Read in Russian</a>
  ·
  <a href="https://talkis.ru">Website</a>
  ·
  <a href="https://github.com/SerTimBerrners-Lee/talkis/releases/latest">Latest release</a>
</p>

<p align="center">
  <img src="docs/demo/demo-1.gif" alt="Talkis dictating a development request into a code editor" width="860">
</p>

## What Is Talkis?

Talkis is a desktop voice-to-text app built with Tauri, React, TypeScript, and Rust. It stays as a small floating widget, records while you hold a hotkey, transcribes your speech, optionally cleans the text with an LLM, and pastes the final result into the app you were using.

It is designed for practical daily work: IDEs, chats, notes, CRM fields, email, files, and meeting transcripts.

## Highlights

- Dictate into any active text field with a global hotkey.
- Use locked recording mode for longer speech without holding the keys.
- Paste cleaned text automatically after transcription.
- Choose cloud mode, your own API key, or local STT and text LLM models.
- Transcribe audio and video files from the Files tab or by dropping files onto the widget.
- Record macOS calls with separate microphone and system-audio tracks.
- Keep local history for voice recordings and file transcriptions.
- Run managed local STT through one native `transcribe.cpp` runtime for Whisper, Qwen ASR, NVIDIA Parakeet, plus local text summaries through a managed GGUF LLM runtime.
- Build native bundles for macOS, Windows, and Linux.

## Latest Changes

### v0.3.12

- Fixed the Windows frontend release build by invoking Vite through its package JavaScript entrypoint instead of the platform-specific `.cmd` shim.
- This release candidate must pass Release Preflight on macOS, Windows, and Linux before a tag is created.

### v0.3.11

- Fixed the Windows release workflow by reusing sidecars prepared during release checks instead of running the sidecar preparation step twice.
- Made sidecar preparation idempotent by skipping copies when the source and destination binaries are already identical.

### v0.3.10

- Hardened the Windows Vite wrapper path normalization used by release builds.
- Split the GitHub Actions release bundle phase into explicit sidecar, frontend, and native bundle steps so Windows packaging failures are visible without raw log access.

### v0.3.9

- Fixed Windows release builds by resolving the Vite wrapper root path with `fileURLToPath`, avoiding malformed `/D:/...` paths on GitHub Actions Windows runners.
- Re-publishing the v0.3.8 app changes with the Windows bundle fix so macOS, Windows, and Linux artifacts can be produced by the release workflow.

### v0.3.8

- Added live local dictation for streaming STT models: the text overlay opens when recording starts, shows partial results while speaking, and still pastes only after stop.
- Improved the text overlay lifecycle so live dictation, translation, and paste errors do not overwrite each other; first-show startup races are handled through an explicit ready handshake.
- Added local selected-text translation with managed local translator options and selection hotkey settings.
- Improved local file transcription for WebM/video inputs and local streaming models by routing files through native preparation and streaming-compatible chunks.
- Reduced voice-history memory pressure by storing completed recording audio through the history audio store instead of keeping large base64 payloads in live history entries.
- Refreshed settings/model UI for local STT, local LLM, local translation, and development chat workflows.

### v0.3.7

- Migrated managed local file transcription to a unified native `transcribe.cpp` runtime for Whisper, Qwen ASR, and NVIDIA Parakeet.
- Removed the old Qwen/Parakeet MLX/Python sidecars from the desktop bundle and release build.
- Fixed local STT settings migration so old Qwen/Parakeet endpoints move to `http://127.0.0.1:8000` and do not require an API key.
- Fixed selecting a local transcription model so it no longer clears the selected text model used for summarization.

### v0.3.6

- Fixed permissions onboarding recovery for existing installs so updates do not reopen the full permissions screen when required macOS access is already granted.
- Switched the app icon set from Lucide to Phosphor through a local icon facade for softer, more consistent product UI icons.
- Added a macOS Vite/esbuild runner workaround for development and release builds from external drives.
- Kept local STT failures separate from API-key authentication errors when a local model is selected.

### v0.3.5

- Fixed local STT mode so managed localhost runtimes are called without a stale API bearer token and no longer show an API-key error for local runtime failures.
- Improved widget notice layout so the status icon stays visually centered next to long messages.
- Prevented call-capture startup errors from resetting the completed permissions onboarding state after restart.

### v0.3.4

- Fixed repeated permission prompts after restarting macOS: startup checks no longer trigger a microphone request, and Accessibility is not reset before re-requesting access.
- Updated the transcription statistics card to show words today, words this month, and words per minute instead of the less useful all-time words metric.

## Demo

The repository includes the same GIF demos used on the Talkis website.

| Demo | What it shows |
| --- | --- |
| [Dictating code](docs/demo/demo-1.gif) | A short development request inserted into an editor |
| [Dictating an email](docs/demo/demo-2.gif) | Business-style speech-to-email flow |
| [Dictating a note](docs/demo/demo-3.gif) | Everyday notes and task capture |
| [Recording a call](docs/demo/demo-4.gif) | Separate call-recording flow from the widget |
| [Transcribing a file](docs/demo/demo-5.gif) | Audio/video file transcription |
| [Choosing models](docs/demo/demo-6.gif) | Local models and own API configuration |

<details>
<summary>Show more demos inline</summary>

### Email Dictation

<img src="docs/demo/demo-2.gif" alt="Talkis dictating an email" width="860">

### Notes

<img src="docs/demo/demo-3.gif" alt="Talkis dictating a note" width="860">

### Call Recording

<img src="docs/demo/demo-4.gif" alt="Talkis recording a call transcript" width="860">

### File Transcription

<img src="docs/demo/demo-5.gif" alt="Talkis transcribing an audio or video file" width="860">

### Local Models And API Keys

<img src="docs/demo/demo-6.gif" alt="Talkis choosing a local model or own API key" width="860">

</details>

## How It Works

1. Focus the text field where you want the result to appear.
2. Hold `Shift + Command + Space` on macOS.
3. Speak naturally.
4. Release the hotkey.
5. Talkis transcribes, cleans, and pastes the text.

The hotkey, microphone, language, model source, cleanup style, and app appearance are configurable in Settings.

## Access Modes

### Talkis Cloud

Sign in to [Talkis Cloud](https://talkis.ru) and use transcription without managing API keys. Requests go through `proxy.talkis.ru`.

### Own API Key

Use an OpenAI-compatible STT endpoint and a separate LLM endpoint for text cleanup. The Models tab also contains API adapter cards for supported providers.

Supported STT model names include:

- `whisper-1`
- `gpt-4o-transcribe`
- `gpt-4o-mini-transcribe`

### Local Models

Install and run Talkis-managed local models from Settings. Local mode can keep both transcription and transcript summaries on your machine: STT models handle audio, and a separate local text LLM handles summary and prompt-based processing.

Managed local runtimes:

- Whisper, NVIDIA Parakeet GGUF, and Qwen ASR GGUF through the unified `transcribe.cpp` runtime, default endpoint `http://127.0.0.1:8000`
- Text LLM summaries through the bundled OpenAI-compatible `talkis-llm` runtime backed by GGUF models such as Qwen2.5 Instruct
- Speaker diarization, default endpoint `http://127.0.0.1:8003`

If a default port is busy, Talkis starts the managed runtime on a fallback port and saves the actual endpoint in settings.

## Installation

Download the latest build from GitHub Releases:

- [macOS DMG](https://github.com/SerTimBerrners-Lee/talkis/releases/latest/download/Talkis-macos.dmg)
- [Windows x64 installer](https://github.com/SerTimBerrners-Lee/talkis/releases/latest/download/Talkis-windows-x64-setup.exe)
- [Linux x64 AppImage](https://github.com/SerTimBerrners-Lee/talkis/releases/latest/download/Talkis-linux-x64.AppImage)

### If your OS blocks the first launch

Talkis is currently distributed **without paid code signing**, so Gatekeeper (macOS) and SmartScreen (Windows) show an "unverified app" warning. This is **not malware**: the source is open (AGPL-3.0) and the builds are produced by the public GitHub Actions workflow in this repo. How to open it:

**macOS** — "Apple could not verify Talkis is free of malware":

1. In the dialog click **Done** (not "Move to Trash").
2. Open **System Settings → Privacy & Security**, scroll down to *"Talkis was blocked…"* and click **Open Anyway**.
3. Confirm with your password or Touch ID and click **Open** again.

Or, in one command in Terminal (after moving it to Applications):

```bash
xattr -dr com.apple.quarantine /Applications/Talkis.app
```

**Windows** — the blue *"Windows protected your PC"* dialog:

1. Click **More info**.
2. Click **Run anyway**.

On first launch, grant the permissions Talkis needs:

- Microphone access for recording.
- Accessibility permission on macOS for automatic paste.
- Screen and System Audio Recording permission on macOS for call recording.

After permissions are granted, Talkis stores the completed onboarding state and
does not reopen native permission prompts on every launch. If an OS permission is
reset or denied later, Talkis asks again only when that access is needed.

## File Transcription

The Files tab supports audio and video transcription up to 8 GB. Files are processed through a native path-based pipeline, so large files do not need to be loaded into WebView memory.

Talkis uses the bundled ffmpeg sidecar for video, unsupported audio formats, chunking, and diarization preparation. Ready `16 kHz` mono PCM WAV files can skip conversion for local STT.

Speaker diarization is available through Talkis Cloud or through local Whisper plus the local diarization runtime, depending on the selected access mode.

## Call Recording

Call recording captures two tracks:

- `You` from the microphone.
- `Call` from system audio.

System-audio capture is implemented with Core Audio on macOS, WASAPI loopback on
Windows, and PipeWire monitor streams on Linux. Linux requires a running PipeWire
daemon with an active output device.

## Privacy

- In cloud mode, requests go through `proxy.talkis.ru`.
- In own-key mode, requests go directly to the endpoints you configure.
- In local mode, transcription stays on your machine.
- API keys and device tokens are stored locally in app settings.
- Voice history and file transcription history are stored locally.
- Talkis does not keep audio on its own servers beyond the API call.

## Troubleshooting

- Nothing is pasted: check macOS System Settings -> Privacy & Security -> Accessibility and make sure Talkis is enabled.
- Transcription contains unexpected foreign characters: choose a fixed recognition language such as `ru` or `en` instead of auto.
- Local STT returns model errors: open `Модели` -> `Локально`, make sure the model is installed and selected, then reinstall it if the runtime reports missing files.
- Call recording cannot start: grant Microphone and the OS system-audio permission, then start the call recording again. On Linux, also make sure PipeWire is running and an output device is active.
- Need deeper diagnostics: open `~/.talkis/talkis.log` or run `bun run logs` during development.

## Development

Requirements:

- Bun `1.2.x`
- Rust stable
- Tauri v2 system dependencies

Install dependencies and start the app:

```bash
bun install
bun run prepare:sidecars
bun run tauri dev
```

Useful commands:

```bash
bunx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
bun run check:release
bun run tauri build
bun run build:release:macos
bun run logs
```

On Ubuntu/Debian, install native Tauri and sidecar build dependencies first:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libxdo-dev libasound2-dev librsvg2-dev patchelf clang libclang-dev cmake
```

## Project Structure

```text
src/                  React and TypeScript frontend
src/windows/widget/   Floating widget window
src/windows/settings/ Settings window and tabs
src/lib/              Store, auth, permissions, logging, shared clients
src-tauri/src/        Rust backend, Tauri commands, audio, paste, STT
src-tauri/icons/      App icons
docs/                 Release docs, audio rules, demo media
scripts/              Release and sidecar preparation scripts
```

For audio, transcription, local STT, file transcription, or call-capture changes, read [docs/audio-pipeline-principles.md](docs/audio-pipeline-principles.md) before editing code.

## Tech Stack

- Tauri v2
- React 19
- TypeScript
- Rust
- cpal native microphone recording
- OpenAI-compatible STT and LLM APIs
- Managed local STT sidecars
- Bundled ffmpeg sidecar

## Contributing

Issues and pull requests are welcome. Before changing audio behavior, read the audio pipeline document and keep enough logging to debug recorder stats, ffmpeg timing, STT endpoint selection, chunk progress, and call-capture levels.

Project conventions:

- UI text is Russian.
- Code and comments are English.
- Package manager is Bun.
- Settings are persisted immediately after change.
- Release workflow is documented in [rules/release.rule.md](rules/release.rule.md).

## License

Talkis is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`).

This license keeps the desktop app open-source and also requires source availability for modified versions that are offered to users over a network, which matters for the Talkis Cloud/API companion surface.
