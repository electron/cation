// 24 Hour Minimum Time
export const MINIMUM_OPEN_TIME = 1000 * 60 * 60 * 24;

// backport type labels
export const NEW_PR_LABEL = 'new-pr 🌱';
export const BACKPORT_LABEL = 'backport';
export const BUG_LABEL = 'bug 🐞';
export const ENHANCEMENT_LABEL = 'enhancement ✨';
export const APP_STORE_LABEL = 'app-store';

// missing information labels
export const MISSING_INFO_LABEL = 'blocked/need-info ❌';
export const NEEDS_REPRO_LABEL = 'blocked/needs-repro ❌';

// platform labels
export const PLATFORM_MAC = 'platform/macOS';
export const PLATFORM_WIN = 'platform/windows';
export const PLATFORM_LINUX = 'platform/linux';

export const EXCLUDE_LABELS = [BACKPORT_LABEL, 'fast-track 🚅'];
export const EXCLUDE_PREFIXES = ['build', 'ci'];
export const EXCLUDE_USERS = ['roller-bot[bot]', 'electron-bot'];
