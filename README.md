# OpenWhisp

OpenWhisp is a Mac-first local dictation prototype inspired by the press-and-hold flow used by Wispr Flow: hold `Fn`, speak, release, and the app transcribes, rewrites, and pastes back into the focused app.

## Stack

- Electron + React + TypeScript for the desktop shell and setup UI
- Local Whisper transcription through `@huggingface/transformers`
- Local rewrite through Ollama, with `qwen2.5:0.5b` as the recommended lightweight text model
- A small Swift helper for macOS-only `Fn` listening, focus checks, and paste events

## Why these default models

- `onnx-community/whisper-base.en` is the current default because it is still small enough for laptop use, but materially more reliable for dictation than the tiny English checkpoint.
- `qwen2.5:0.5b` is the recommended rewrite model because it is close to the requested 0.4B class, fast in Ollama, and much stronger than the very smallest models at following tightly-scoped rewrite prompts.

## Current behavior

1. On first launch, the setup window asks for microphone and macOS system-control permissions.
2. The app can prepare the local Whisper model and pull the recommended Ollama model.
3. The overlay appears near the bottom of the screen while dictation is active.
4. `Fn` down starts recording.
5. `Fn` up stops recording, transcribes locally, rewrites with the selected level, and pastes into the active app if the frontmost control looks editable.

## Commands

```bash
npm install
npm run build:native
npm run dev
```

For a packaged app:

```bash
npm run package
```

## Notes

- The Swift helper is compiled locally in development and bundled from `build/native` during packaging.
- macOS may require both Accessibility and Input Monitoring approval before global `Fn` capture works.
- The current implementation keeps recordings in memory and only persists settings plus downloaded model files in the chosen storage folder.
