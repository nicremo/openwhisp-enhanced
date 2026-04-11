import { fileURLToPath } from 'node:url';

import { BrowserWindow, screen } from 'electron';

const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
const rendererFilePath = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const overlayWidth = 420;
const overlayHeight = 102;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getRendererEntry(hash = ''): string {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    return hash ? `${rendererUrl.replace(/\/$/, '')}/#${hash}` : rendererUrl;
  }

  return rendererFilePath + (hash ? `#${hash}` : '');
}

async function loadRendererWindow(window: BrowserWindow, hash = ''): Promise<void> {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    await window.loadURL(getRendererEntry(hash));
    return;
  }

  await window.loadFile(rendererFilePath, {
    hash,
  });
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 400,
    minHeight: 700,
    show: false,
    backgroundColor: '#f5f5ef',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: {
      x: 18,
      y: 18,
    },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  await loadRendererWindow(window);
  return window;
}

export function positionOverlayWindow(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const margin = 18;
  const workArea = display.workArea;
  const minX = workArea.x + margin;
  const maxX = workArea.x + workArea.width - overlayWidth - margin;
  const minY = workArea.y + margin;
  const maxY = workArea.y + workArea.height - overlayHeight - margin;
  const preferredBelowY = cursor.y + 26;
  const preferredAboveY = cursor.y - overlayHeight - 26;
  const x = clamp(cursor.x - Math.round(overlayWidth / 2), minX, maxX);
  const y =
    preferredBelowY <= maxY
      ? preferredBelowY
      : clamp(preferredAboveY, minY, maxY);

  window.setBounds({
    x,
    y,
    width: overlayWidth,
    height: overlayHeight,
  });
}

export async function createOverlayWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setAlwaysOnTop(true, 'floating');
  window.setIgnoreMouseEvents(true);
  positionOverlayWindow(window);

  await loadRendererWindow(window, 'overlay');

  return window;
}
