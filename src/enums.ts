export enum CheckRunStatus {
  NEUTRAL = 'neutral',
  FAILURE = 'failure',
  SUCCESS = 'success',
}

export enum LogLevel {
  LOG,
  INFO,
  WARN,
  ERROR,
}

export enum ApiReviewAction {
  LGTM = 'lgtm',
  REQUEST_CHANGES = 'r-changes',
  DECLINE = 'decline',
}
