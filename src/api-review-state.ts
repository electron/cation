import { Application } from 'probot';
import { API_REVIEW_CHECK_NAME, CheckRunStatus, REVIEW_LABELS, SEMVER_LABELS } from './constants';
import { isAPIReviewRequired } from './utils/check-utils';

export function setupAPIReviewStateManagement(probot: Application) {
  probot.on('pull_request.labeled', async context => {
    const { label, pull_request: pr } = context.payload;

    // If a PR is semver-minor or semver-major, automatically
    // add the 'api-review/requested 🗳' label.
    if ([SEMVER_LABELS.MINOR, SEMVER_LABELS.MAJOR].includes(label!.name)) {
      probot.log(
        'Received a semver-minor or semver-major PR:',
        `${context.payload.repository.full_name}#${pr.number}`,
        "Adding the 'api-review/requested 🗳' label",
      );

      context.github.issues.addLabels(
        context.repo({
          issue_number: pr.number,
          labels: [REVIEW_LABELS.REQUESTED],
        }),
      );
    }
  });

  probot.on('pull_request.unlabeled', async context => {
    const { label, pull_request: pr } = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // We want to prevent tampering with api-review/* labels other than
    // request labels - the bot should control the full review lifecycle.
    if (Object.keys(REVIEW_LABELS).includes(label.name)) {
      const { data: allChecks } = await context.github.checks.listForRef(
        context.repo({
          ref: pr.head.sha,
          per_page: 100,
        }),
      );

      const checkRun = allChecks.check_runs.find(run => run.name === API_REVIEW_CHECK_NAME);

      // The 'api-review/requested 🗳' label can be removed if it does not violate requirements.
      if (checkRun && label.name === REVIEW_LABELS.REQUESTED && !isAPIReviewRequired(pr)) {
        await context.github.checks.update(
          context.repo({
            name: API_REVIEW_CHECK_NAME,
            status: 'queued',
            check_run_id: checkRun.id,
            conclusion: CheckRunStatus.NEUTRAL,
            completed_at: new Date().toISOString(),
          }),
        );
      } else {
        // Put the label back. Bad human.
        context.github.issues.addLabels(
          context.repo({
            issue_number: pr.number,
            labels: [label.name],
          }),
        );
      }
    }
  });
}
