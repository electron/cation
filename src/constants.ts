// 24 Hour Minimum Time
export const MINIMUM_PATCH_OPEN_TIME = 1000 * 60 * 60 * 24;
// 168 Hour Minimum Time
export const MINIMUM_MINOR_OPEN_TIME = 1000 * 60 * 60 * 24 * 7;
// 168 Hour Minimum Time
export const MINIMUM_MAJOR_OPEN_TIME = 1000 * 60 * 60 * 24 * 7;

// backport type labels
export const NEW_PR_LABEL = 'new-pr 🌱';
export const BACKPORT_LABEL = 'backport';
export const BACKPORT_SKIP_LABEL = 'backport-check-skip';
export const FAST_TRACK_LABEL = 'fast-track 🚅';

export const SEMVER_NONE_LABEL = 'semver/none';
export const SEMVER_LABELS = {
  PATCH: 'semver/patch',
  MINOR: 'semver/minor',
  MAJOR: 'semver/major',
};

export const API_REVIEW_PREFIX = 'api-review/';

export const REVIEW_LABELS = {
  REQUESTED: 'api-review/requested 🗳',
  APPROVED: 'api-review/approved ✅',
  DECLINED: 'api-review/declined ❌',
};

export const API_REVIEW_CHECK_NAME = 'API Review';

export const API_WORKING_GROUP = 'wg-api';

// exclusion labels
export const EXCLUDE_LABELS = [BACKPORT_LABEL, BACKPORT_SKIP_LABEL, FAST_TRACK_LABEL];
export const EXCLUDE_PREFIXES = ['build', 'ci', 'test'];
export const EXCLUDE_USERS = ['roller-bot[bot]', 'electron-bot'];
