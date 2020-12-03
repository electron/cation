import { WebhookPayloadWithRepository } from 'probot';
import { SEMVER_LABELS } from '../constants';

/**
 * Returns whether or not the 'api-review/requested 🗳' label
 * can be removed from a given pull request without violating
 * requirements.
 *
 * @param pr The pull request being checked for API Review requirements.
 */
export function isAPIReviewRequired(pr: WebhookPayloadWithRepository['pull_request']): boolean {
  if (!pr) return false;

  // If it's not a semver-patch PR it must be reviewed.
  for (const label of pr.labels) {
    if ([SEMVER_LABELS.MAJOR, SEMVER_LABELS.MINOR].includes(label.name)) {
      return true;
    }
  }

  return false;
}
