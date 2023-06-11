import { Probot } from 'probot';
import {
  DOCUMENTATION_LABEL,
  SEMANTIC_PREFIXES,
  SEMVER_LABELS,
  SEMVER_NONE_LABEL,
  SEMVER_PREFIX,
} from './constants';
import { LogLevel } from './enums';
import { addLabels } from './utils/label-utils';
import { log } from './utils/log-util';

export function addBasicPRLabels(probot: Probot) {
  probot.on(['pull_request.opened', 'pull_request.edited'], async (context) => {
    const { pull_request: pr } = context.payload;

    // Only add triage labels to the default branch.
    if (pr.base.ref !== pr.base.repo.default_branch) return;

    const hasSemverLabel = pr.labels.some(({ name }) => name.startsWith(SEMVER_PREFIX));

    // Respect existing semver labels.
    if (hasSemverLabel) {
      log(
        'addBasicPRLabels',
        LogLevel.INFO,
        `#${pr.number} has an existing semver label - aborting`,
      );
      return;
    }

    const semanticPrefix = pr.title.split(':')[0];

    const isDocsPR = semanticPrefix === SEMANTIC_PREFIXES.DOCS;
    const isCIPR = semanticPrefix === SEMANTIC_PREFIXES.CI;
    const isTestPR = semanticPrefix === SEMANTIC_PREFIXES.TEST;
    const isBuildPR = semanticPrefix === SEMANTIC_PREFIXES.BUILD;

    // Label Docs PRs as Semver-Patch PRs.
    if (isDocsPR) {
      log(
        'addBasicPRLabels',
        LogLevel.INFO,
        `#${pr.number} is a docs PR - adding ${SEMVER_LABELS.PATCH} label`,
      );
      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [SEMVER_LABELS.PATCH, DOCUMENTATION_LABEL],
      });
    } else if (isCIPR || isTestPR || isBuildPR) {
      // CI, Test, and Build PRs do not affect Semver.
      log(
        'addBasicPRLabels',
        LogLevel.INFO,
        `#${pr.number} is a ci, test, or build PR - adding ${SEMVER_NONE_LABEL} label`,
      );
      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [SEMVER_NONE_LABEL],
      });
    }
  });
}
