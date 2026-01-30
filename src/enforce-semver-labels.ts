import { Context, Probot } from 'probot';
import { SEMVER_LABELS, SEMVER_NONE_LABEL } from './constants';
import { log } from './utils/log-util';
import { LogLevel } from './enums';

const ALL_SEMVER_LABELS = [
  SEMVER_LABELS.MAJOR,
  SEMVER_LABELS.MINOR,
  SEMVER_LABELS.PATCH,
  SEMVER_NONE_LABEL,
];

export function setupSemverLabelEnforcement(probot: Probot) {
  probot.on(
    [
      'pull_request.opened',
      'pull_request.unlabeled',
      'pull_request.labeled',
      'pull_request.synchronize',
    ],
    async (context: Context<'pull_request'>) => {
      const { pull_request: pr } = context.payload;

      log('setupSemverLabelEnforcement', LogLevel.INFO, `Checking #${pr.number} for semver label`);

      const semverLabels = pr.labels.filter((l) => ALL_SEMVER_LABELS.includes(l.name));
      if (semverLabels.length === 0) {
        log('setupSemverLabelEnforcement', LogLevel.ERROR, `#${pr.number} is missing semver label`);

        await context.octokit.rest.checks.create(
          context.repo({
            name: 'Semver Label Enforcement',
            head_sha: pr.head.sha,
            status: 'in_progress',
            output: {
              title: 'No semver/* label found',
              summary: "We couldn't find a semver/* label, please add one",
            },
          }),
        );
      } else if (semverLabels.length > 1) {
        log(
          'setupSemverLabelEnforcement',
          LogLevel.ERROR,
          `#${pr.number} has duplicate semver labels`,
        );

        await context.octokit.rest.checks.create(
          context.repo({
            name: 'Semver Label Enforcement',
            head_sha: pr.head.sha,
            status: 'in_progress',
            output: {
              title: 'Multiple semver/* labels found',
              summary: 'We found multiple semver/* labels, please remove one',
            },
          }),
        );
      } else {
        log('setupSemverLabelEnforcement', LogLevel.INFO, `#${pr.number} has a valid semver label`);

        await context.octokit.rest.checks.create(
          context.repo({
            name: 'Semver Label Enforcement',
            head_sha: pr.head.sha,
            status: 'completed',
            conclusion: 'success',
            output: {
              title: `Found "${semverLabels[0].name}"`,
              summary: 'Found a single semver/* label, looking good here.',
            },
          }),
        );
      }
    },
  );
}
