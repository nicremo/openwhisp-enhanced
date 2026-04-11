import { useEffect, useRef, useState } from 'react';

import { AudioRecorder } from './audio-recorder';
import type { AppStatus, BootstrapState, EnhancementLevel, FocusInfo } from '../shared/types';
import { RECOMMENDED_TEXT_MODEL, RECOMMENDED_WHISPER_LABEL } from '../shared/recommendations';

const OVERLAY_VIEW = window.location.hash === '#overlay';

const LEVEL_OPTIONS: Array<{ value: EnhancementLevel; label: string; caption: string }> = [
  { value: 'none', label: 'No filter', caption: 'Fastest pass. Keep the wording almost untouched.' },
  { value: 'soft', label: 'Soft', caption: 'Fix grammar and cleanup with a light touch.' },
  { value: 'medium', label: 'Medium', caption: 'Default. Improve clarity while keeping intent intact.' },
  { value: 'high', label: 'High', caption: 'Most polished. Expand shorthand into professional prose.' },
];

function formatBytes(size: number): string {
  if (size <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let current = size;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [status, setStatus] = useState<AppStatus>({
    phase: 'idle',
    title: 'Ready',
    detail: 'Hold Fn to dictate. Release Fn to paste.',
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const bootstrapRef = useRef<BootstrapState | null>(null);
  const onboardingAttemptedRef = useRef(false);
  const targetFocusRef = useRef<FocusInfo | null>(null);

  useEffect(() => {
    bootstrapRef.current = bootstrap;
  }, [bootstrap]);

  useEffect(() => {
    let mounted = true;

    const loadBootstrap = async () => {
      const nextBootstrap = await window.openWhisp.bootstrap();
      if (!mounted) {
        return;
      }

      setBootstrap(nextBootstrap);
      setStatus(nextBootstrap.status);
    };

    void loadBootstrap();

    const stopStatus = window.openWhisp.onStatus((nextStatus) => {
      if (mounted) {
        setStatus(nextStatus);
      }
    });

    const stopHotkey = OVERLAY_VIEW
      ? window.openWhisp.onHotkey((event) => {
          if (event.type === 'down') {
            void handleHotkeyDown();
          }

          if (event.type === 'up') {
            void handleHotkeyUp();
          }
        })
      : () => undefined;

    return () => {
      mounted = false;
      stopStatus();
      stopHotkey();
    };
  }, []);

  useEffect(() => {
    if (OVERLAY_VIEW) {
      recorderRef.current = new AudioRecorder();
    }
  }, []);

  useEffect(() => {
    if (OVERLAY_VIEW || !bootstrap || onboardingAttemptedRef.current) {
      return;
    }

    onboardingAttemptedRef.current = true;

    const runOnboarding = async () => {
      let nextState = bootstrap;

      if (nextState.permissions.microphone !== 'granted') {
        nextState = await window.openWhisp.requestMicrophoneAccess();
        bootstrapRef.current = nextState;
        setBootstrap(nextState);
        setStatus(nextState.status);
      }

      if (
        !nextState.permissions.accessibility ||
        !nextState.permissions.inputMonitoring ||
        !nextState.permissions.postEvents
      ) {
        nextState = await window.openWhisp.requestSystemAccess();
        bootstrapRef.current = nextState;
        setBootstrap(nextState);
        setStatus(nextState.status);
      }
    };

    void runOnboarding();
  }, [bootstrap]);

  const refreshBootstrap = async () => {
    const nextBootstrap = await window.openWhisp.bootstrap();
    bootstrapRef.current = nextBootstrap;
    setBootstrap(nextBootstrap);
    setStatus(nextBootstrap.status);
    return nextBootstrap;
  };

  const pushStatus = (nextStatus: AppStatus) => {
    setStatus(nextStatus);
    window.openWhisp.pushStatus(nextStatus);
  };

  const runAction = async (label: string, action: () => Promise<BootstrapState>) => {
    try {
      setBusyAction(label);
      const nextBootstrap = await action();
      bootstrapRef.current = nextBootstrap;
      setBootstrap(nextBootstrap);
      setStatus(nextBootstrap.status);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OpenWhisp could not complete this action.';
      pushStatus({
        phase: 'error',
        title: 'Action failed',
        detail: message,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleHotkeyDown = async () => {
    const current = bootstrapRef.current ?? (await refreshBootstrap());
    const selectedModelInstalled = current.ollamaModels.some(
      (model) => model.name === current.settings.textModel,
    );

    if (recordingRef.current || processingRef.current) {
      return;
    }

    if (current.permissions.microphone !== 'granted') {
      pushStatus({
        phase: 'error',
        title: 'Microphone needed',
        detail: 'OpenWhisp needs microphone access before dictation can start.',
      });
      await window.openWhisp.showMainWindow();
      return;
    }

    if (!current.permissions.inputMonitoring || !current.permissions.postEvents || !current.permissions.accessibility) {
      pushStatus({
        phase: 'error',
        title: 'System access needed',
        detail: 'Enable Input Monitoring, Accessibility, and Paste permissions in setup first.',
      });
      await window.openWhisp.showMainWindow();
      return;
    }

    if (!current.speechModelReady) {
      pushStatus({
        phase: 'error',
        title: 'Speech model unavailable',
        detail: 'Download the local Whisper speech model in setup before dictation can start.',
      });
      await window.openWhisp.showMainWindow();
      return;
    }

    if (!current.ollamaReachable || !selectedModelInstalled) {
      pushStatus({
        phase: 'error',
        title: 'Text model unavailable',
        detail: 'Start Ollama and make sure the selected rewrite model is installed.',
      });
      await window.openWhisp.showMainWindow();
      return;
    }

    try {
      targetFocusRef.current = await window.openWhisp.captureFocusTarget();
      await window.openWhisp.hideMainWindow();
      recordingRef.current = true;
      await recorderRef.current?.start();
      pushStatus({
        phase: 'listening',
        title: 'Listening',
        detail: 'Speak while holding Fn.',
      });
    } catch (error) {
      recordingRef.current = false;
      pushStatus({
        phase: 'error',
        title: 'Microphone error',
        detail: error instanceof Error ? error.message : 'The microphone could not start.',
      });
    }
  };

  const handleHotkeyUp = async () => {
    if (!recordingRef.current || processingRef.current) {
      return;
    }

    recordingRef.current = false;
    processingRef.current = true;

    try {
      const wavBase64 = await recorderRef.current?.stop();
      if (!wavBase64) {
        throw new Error('No recording was captured.');
      }

      const result = await window.openWhisp.processAudio({
        wavBase64,
        targetFocus: targetFocusRef.current ?? undefined,
      });
      pushStatus({
        phase: result.pasted ? 'done' : 'done',
        title: result.pasted ? 'Pasted' : 'Copied',
        detail: result.pasted
          ? 'The refined text was pasted into the active app.'
          : 'The refined text is on the clipboard.',
        preview: result.finalText,
        rawText: result.rawText,
      });
    } catch (error) {
      pushStatus({
        phase: 'error',
        title: 'Dictation failed',
        detail: error instanceof Error ? error.message : 'OpenWhisp could not finish this dictation.',
      });
    } finally {
      targetFocusRef.current = null;
      processingRef.current = false;
    }
  };

  if (OVERLAY_VIEW) {
    return <OverlayChip status={status} />;
  }

  if (!bootstrap) {
    return <main className="app-shell loading-shell">Loading OpenWhisp…</main>;
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">OpenWhisp</p>
          <h1>Hold Fn to talk. Release Fn to paste.</h1>
        </div>
        <p className="hero-copy">
          Local Whisper transcription, local Ollama rewriting, and a small Mac overlay tuned for
          fast dictation.
        </p>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Setup</h2>
          <button className="ghost-button quick-action-button" onClick={() => void refreshBootstrap()}>
            Refresh
          </button>
        </div>

        <SetupRow
          title="Microphone"
          description="Required to capture dictation. If macOS does not show a prompt, OpenWhisp opens the Microphone settings page."
          ready={bootstrap.permissions.microphone === 'granted'}
          actionLabel={busyAction === 'mic' ? 'Requesting…' : 'Enable'}
          onAction={() =>
            void runAction('mic', () => window.openWhisp.requestMicrophoneAccess())
          }
        />
        <SetupRow
          title="System control"
          description="Needed for Fn listening and paste into the active app. In development, macOS may show Electron and openwhisp-helper in Privacy & Security."
          ready={
            bootstrap.permissions.accessibility &&
            bootstrap.permissions.inputMonitoring &&
            bootstrap.permissions.postEvents
          }
          actionLabel={busyAction === 'system' ? 'Opening…' : 'Enable'}
          onAction={() => void runAction('system', () => window.openWhisp.requestSystemAccess())}
        />
        <SetupRow
          title={RECOMMENDED_WHISPER_LABEL}
          description="Recommended local speech model. Download once and reuse."
          ready={bootstrap.speechModelReady}
          actionLabel={busyAction === 'speech' ? 'Preparing…' : 'Download speech model'}
          onAction={() => void runAction('speech', () => window.openWhisp.prepareSpeechModel())}
        />
        <SetupRow
          title={RECOMMENDED_TEXT_MODEL}
          description={
            bootstrap.ollamaReachable
              ? 'Recommended fastest rewrite model for this workflow. You can still switch to a larger local model if you prefer stronger polishing over latency.'
              : 'Start Ollama first. OpenWhisp expects it at the configured local URL before it can pull or use rewrite models.'
          }
          ready={bootstrap.recommendedModelInstalled}
          actionLabel={
            bootstrap.ollamaReachable
              ? busyAction === 'model'
                ? 'Downloading…'
                : 'Download text model'
              : 'Ollama offline'
          }
          disabled={!bootstrap.ollamaReachable}
          onAction={() => void runAction('model', () => window.openWhisp.pullRecommendedModel())}
        />
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Models</h2>
          <button
            className="ghost-button quick-action-button"
            onClick={() => void runAction('refresh-ollama', () => window.openWhisp.refreshOllama())}
          >
            Refresh Ollama
          </button>
        </div>

        <div className="field">
          <label htmlFor="model-select">Rewrite model</label>
          <select
            id="model-select"
            value={bootstrap.settings.textModel}
            onChange={(event) =>
              void runAction('settings', () =>
                window.openWhisp.updateSettings({ textModel: event.target.value }),
              )
            }
          >
            {bootstrap.ollamaModels.length === 0 ? (
              <option value={bootstrap.settings.textModel}>{bootstrap.settings.textModel}</option>
            ) : (
              bootstrap.ollamaModels.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.name} · {formatBytes(model.size)}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="field">
          <label htmlFor="base-url">Ollama base URL</label>
          <input
            id="base-url"
            value={bootstrap.settings.ollamaBaseUrl}
            onChange={(event) =>
              setBootstrap({
                ...bootstrap,
                settings: {
                  ...bootstrap.settings,
                  ollamaBaseUrl: event.target.value,
                },
              })
            }
            onBlur={() =>
              void runAction('settings', () =>
                window.openWhisp.updateSettings({ ollamaBaseUrl: bootstrap.settings.ollamaBaseUrl }),
              )
            }
          />
          {!bootstrap.ollamaReachable && (
            <p className="hint">
              Ollama is not responding. Install it from{' '}
              <button
                className="inline-button"
                onClick={() => void window.openWhisp.openExternal('https://ollama.com/download/mac')}
              >
                ollama.com
              </button>
              .
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Rewrite level</h2>
        </div>

        <div className="level-grid">
          {LEVEL_OPTIONS.map((level) => (
            <button
              key={level.value}
              className={`level-button ${
                bootstrap.settings.enhancementLevel === level.value ? 'level-button-active' : ''
              }`}
              onClick={() =>
                void runAction('settings', () =>
                  window.openWhisp.updateSettings({ enhancementLevel: level.value }),
                )
              }
            >
              <span>{level.label}</span>
              <small>{level.caption}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Storage</h2>
        </div>

        <p className="storage-path">{bootstrap.settings.storageDirectory}</p>
        <div className="button-row">
          <button className="ghost-button" onClick={() => void runAction('storage', () => window.openWhisp.chooseStorage())}>
            Choose folder
          </button>
          <button className="ghost-button" onClick={() => void window.openWhisp.revealStorage()}>
            Open folder
          </button>
        </div>

        <label className="toggle">
          <input
            type="checkbox"
            checked={bootstrap.settings.autoPaste}
            onChange={(event) =>
              void runAction('settings', () =>
                window.openWhisp.updateSettings({ autoPaste: event.target.checked }),
              )
            }
          />
          <span>Auto-paste into the active app after rewriting</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={bootstrap.settings.launchAtLogin}
            onChange={(event) =>
              void runAction('settings', () =>
                window.openWhisp.updateSettings({ launchAtLogin: event.target.checked }),
              )
            }
          />
          <span>Launch at login</span>
        </label>
      </section>

      <section className="section live-section">
        <div className="section-heading">
          <h2>Live</h2>
        </div>
        <StatusSummary status={status} />
      </section>
    </main>
  );
}

function SetupRow(props: {
  title: string;
  description: string;
  ready: boolean;
  actionLabel: string;
  disabled?: boolean;
  onAction: () => void;
}) {
  return (
    <div className="setup-row">
      <div>
        <div className="setup-title">
          <strong>{props.title}</strong>
          <span className={`badge ${props.ready ? 'badge-ready' : 'badge-pending'}`}>
            {props.ready ? 'Ready' : 'Needed'}
          </span>
        </div>
        <p>{props.description}</p>
      </div>
      <button className="primary-button" onClick={props.onAction} disabled={props.disabled}>
        {props.actionLabel}
      </button>
    </div>
  );
}

function StatusSummary({ status }: { status: AppStatus }) {
  return (
    <div className="status-summary">
      <div className="status-topline">
        <strong>{status.title}</strong>
        <span>{status.phase}</span>
      </div>
      <p>{status.detail}</p>
      {status.preview && <pre>{status.preview}</pre>}
    </div>
  );
}

function OverlayChip({ status }: { status: AppStatus }) {
  return (
    <div className={`overlay-shell overlay-${status.phase}`}>
      <div className="overlay-chip">
        <div className="overlay-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="overlay-copy">
          <strong>{status.title}</strong>
          <span>{status.detail}</span>
        </div>
      </div>
    </div>
  );
}
