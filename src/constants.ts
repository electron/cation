// 24 Hour Minimum Time
export const MINIMUM_OPEN_TIME = 1000 * 60 * 60 * 24;

// backport type labels
export const NEW_PR_LABEL = 'new-pr 🌱';
export const BACKPORT_LABEL = 'backport';
export const FAST_TRACK_LABEL = 'fast-track 🚅';

// exclusion labels
export const EXCLUDE_LABELS = [BACKPORT_LABEL, FAST_TRACK_LABEL];
export const EXCLUDE_PREFIXES = ['build', 'ci', 'test'];
export const EXCLUDE_USERS = ['roller-bot[bot]', 'electron-bot'];
