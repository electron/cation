import { Probot } from 'probot';
import {
  DOCUMENTATION_LABEL,
  SEMANTIC_PREFIXES,
  SEMVER_LABELS,
  SEMVER_NONE_LABEL,
  SEMVER_PREFIX,
} from './constants';
import { addLabels } from './utils/label-utils';

export function addBasicPRLabels(probot: Probot) {
  probot.on(['pull_request.opened', 'pull_request.edited'], async context => {
    const { pull_request: pr } = context.payload;

    // Only add triage labels to the default branch.
    if (pr.base.ref !== pr.base.repo.default_branch) return;

    const hasSemverLabel = pr.labels.some((l: any) => {
      l.name.startsWith(SEMVER_PREFIX);
    });

    // Respect existing semver labels.
    if (hasSemverLabel) return;

    const semanticPrefix = pr.title.split(':')[0];

    // Label Docs PRs as Semver-Patch PRs.
    const isDocsPR = semanticPrefix === SEMANTIC_PREFIXES.DOCS;
    const isCIPR = semanticPrefix === SEMANTIC_PREFIXES.CI;
    const isTestPR = semanticPrefix === SEMANTIC_PREFIXES.TEST;
    const isBuildPR = semanticPrefix === SEMANTIC_PREFIXES.BUILD;

    if (isDocsPR) {
      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [SEMVER_LABELS.PATCH, DOCUMENTATION_LABEL],
      });
    } else if (isCIPR || isTestPR || isBuildPR) {
      // CI, Test, and Build PRs do not affect Semver.
      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [SEMVER_NONE_LABEL],
      });
    }
  });
}
