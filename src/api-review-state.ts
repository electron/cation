import { Application } from 'probot';
import { ORGANIZATION, REPO, REVIEW_LABELS, SEMVER_LABELS } from './constants';

export function setupAPIReviewStateManagement(probot: Application) {
  probot.on('pull_request.labeled', async context => {
    const {
      label,
      pull_request: { number },
    } = context.payload;

    // If a PR is semver-minor or semver-major, automatically
    // add the 'api-review/requested 🗳' label.
    if ([SEMVER_LABELS.MINOR, SEMVER_LABELS.MAJOR].includes(label!.name)) {
      probot.log(
        'Received a semver-minor or semver-major PR:',
        `${context.payload.repository.full_name}#${number}`,
        "Adding the 'api-review/requested 🗳' label",
      );

      context.github.issues.addLabels({
        owner: ORGANIZATION,
        repo: REPO,
        issue_number: number,
        labels: [REVIEW_LABELS.REQUESTED],
      });
    }
  });
}
