export interface KineticToken {
  char: string;
  index: number;
  isSpace: boolean;
  delayMs: number;
}

export interface PasswordValidationResult {
  valid: boolean;
  error: string | null;
  strength: 'empty' | 'weak' | 'fair' | 'strong';
}

export const KINETIC_STARTUP_PHRASES = [
  'Offline Voice Journal',
  'Expressive Typography Archive',
  'Private Local Whisper Vault',
  'Speak. Reflect. Remember.',
] as const;

/**
 * Splits a headline or display phrase into indexed character tokens with
 * compositor-safe staggered animation delays for kinetic lettering.
 */
export function tokenizeKineticHeadline(
  text: string,
  baseDelayMs = 40,
  stepMs = 34
): KineticToken[] {
  return Array.from(text).map((char, index) => ({
    char,
    index,
    isSpace: char === ' ',
    delayMs: baseDelayMs + index * stepMs,
  }));
}

export function computePasswordStrength(
  password: string
): 'empty' | 'weak' | 'fair' | 'strong' {
  const trimmed = password.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length < 4) return 'weak';

  let score = 0;
  if (trimmed.length >= 8) score += 1;
  if (/[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed)) score += 1;
  if (/\d/.test(trimmed)) score += 1;
  if (/[^A-Za-z0-9]/.test(trimmed)) score += 1;

  if (score >= 3 || trimmed.length >= 12) return 'strong';
  if (score >= 1 || trimmed.length >= 6) return 'fair';
  return 'weak';
}

export function validateVaultPassword(
  password: string,
  options: { required?: boolean; confirmPassword?: string } = {}
): PasswordValidationResult {
  const trimmed = password.trim();
  const strength = computePasswordStrength(trimmed);

  if (trimmed.length === 0) {
    if (options.required) {
      return {
        valid: false,
        error: 'Please enter your vault password.',
        strength: 'empty',
      };
    }
    return { valid: true, error: null, strength: 'empty' };
  }

  if (trimmed.length < 4) {
    return {
      valid: false,
      error: 'Password must be at least 4 characters.',
      strength: 'weak',
    };
  }

  if (
    typeof options.confirmPassword === 'string' &&
    trimmed !== options.confirmPassword.trim()
  ) {
    return {
      valid: false,
      error: 'Passwords do not match.',
      strength,
    };
  }

  return { valid: true, error: null, strength };
}

export async function verifyPasswordHash(
  password: string,
  expectedHash: string | null | undefined,
  hasher: (input: string) => Promise<string>
): Promise<boolean> {
  const trimmed = password.trim();
  if (!trimmed || !expectedHash) return false;
  const actualHash = await hasher(trimmed);
  return actualHash === expectedHash;
}

export type StartupDestination = 'splash' | 'welcome-login' | 'app';

export interface StartupGateInput {
  loading: boolean;
  splashDone: boolean;
  autostartSkip: boolean;
  sessionUnlocked: boolean;
  manualLoginRequested: boolean;
  settings: {
    hasCompletedOnboarding: boolean;
    appLockEnabled: boolean;
    appLockPinHash: string | null;
  } | null;
}

/**
 * Resolves which top-level screen ECHO should render so app contents are never
 * revealed before initial resources finish loading and persisted vault auth is checked.
 */
export function resolveStartupDestination(input: StartupGateInput): StartupDestination {
  if (input.autostartSkip && !input.loading && input.settings) {
    return 'app';
  }
  if (!input.splashDone || input.loading || !input.settings) {
    return 'splash';
  }
  if (input.manualLoginRequested) {
    return 'welcome-login';
  }
  const hasPersistedLock = Boolean(
    input.settings.appLockEnabled && input.settings.appLockPinHash
  );
  if (hasPersistedLock && !input.sessionUnlocked) {
    return 'welcome-login';
  }
  if (!input.settings.hasCompletedOnboarding && !input.sessionUnlocked) {
    return 'welcome-login';
  }
  return 'app';
}

