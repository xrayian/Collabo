/**
 * lib/session.ts
 * Browser sessionStorage helpers for display name persistence.
 * Note: Auth code is explicitly NEVER stored in sessionStorage.
 */

const DISPLAY_NAME_KEY = 'collabo_display_name';

export function getStoredDisplayName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(DISPLAY_NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredDisplayName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = name.trim();
    if (trimmed) {
      window.sessionStorage.setItem(DISPLAY_NAME_KEY, trimmed);
    }
  } catch {
    // Ignore sessionStorage quota / privacy errors
  }
}
