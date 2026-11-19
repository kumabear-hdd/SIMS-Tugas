import type { NotificationPermissionState } from './simsLogic';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContextClass(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function detectStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    nav.standalone === true
  );
}

export function getNotificationPermissionSafe(): NotificationPermissionState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission as NotificationPermissionState;
}

export async function unlockNotificationAudio(): Promise<boolean> {
  try {
    const AudioCtx = getAudioContextClass();
    if (!AudioCtx) return false;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      await sharedAudioCtx.resume();
    }
    return sharedAudioCtx.state === 'running';
  } catch {
    return false;
  }
}

export async function playNotificationChime(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([180, 90, 180]);
    }

    const AudioCtx = getAudioContextClass();
    if (!AudioCtx) return false;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      await sharedAudioCtx.resume();
    }
    if (sharedAudioCtx.state !== 'running') {
      return false;
    }

    const ctx = sharedAudioCtx;
    const now = ctx.currentTime;
    // Pleasant 3-note chime (E5 -> G#5 -> B5)
    const notes = [
      { freq: 659.25, start: 0, duration: 0.16, gain: 0.18 },
      { freq: 830.61, start: 0.11, duration: 0.18, gain: 0.18 },
      { freq: 987.77, start: 0.22, duration: 0.28, gain: 0.2 },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      gainNode.gain.setValueAtTime(0.0001, now + note.start);
      gainNode.gain.exponentialRampToValueAtTime(note.gain, now + note.start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.duration + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}

export async function requestPwaNotificationPermission(): Promise<NotificationPermissionState> {
  await unlockNotificationAudio();
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return getNotificationPermissionSafe();
  }
}

export async function showPwaScreenNotification(params: {
  title: string;
  body: string;
  tag?: string;
  notificationId?: number;
}): Promise<boolean> {
  if (getNotificationPermissionSafe() !== 'granted') {
    return false;
  }

  const notifOptions = {
    body: params.body || 'Ada pembaruan terbaru di SIMS Tugas.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: params.tag || `sims-notif-${params.notificationId ?? Date.now()}`,
    renotify: true,
    vibrate: [200, 100, 200],
    data: { notificationId: params.notificationId },
  } as NotificationOptions;

  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(params.title, notifOptions);
        return true;
      }
    }
  } catch {
    // Fall back to Window Notification API below
  }

  try {
    new Notification(params.title, {
      body: notifOptions.body,
      icon: notifOptions.icon,
      tag: notifOptions.tag,
    });
    return true;
  } catch {
    return false;
  }
}
