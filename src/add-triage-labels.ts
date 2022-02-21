import { Probot } from 'probot';
import {
  DOCUMENTATION_LABEL,
  SEMANTIC_PREFIXES,
  SEMVER_LABELS,
  SEMVER_NONE_LABEL,
  SEMVER_PREFIX,
} from './constants';
import { addLabels, labelExistsOnPR } from './utils/label-utils';

export function addBasicPRLabels(probot: Probot) {
  probot.on(['pull_request.opened', 'pull_request.edited'], async context => {
    const { pull_request: pr } = context.payload;

    const hasSemverLabel = pr.labels.some((l: any) => {
      l.name.startsWith(SEMVER_PREFIX);
    });

    // Respect existing semver labels.
    if (hasSemverLabel) return;

    const getSemanticPrefix = (title: string) => title.split(':')[0];

    // Label Docs PRs as Semver-Patch PRs.
    const isDocsPR = getSemanticPrefix(pr.title) === SEMANTIC_PREFIXES.DOCS;
    if (isDocsPR) {
      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [SEMVER_LABELS.PATCH, DOCUMENTATION_LABEL],
      });
    }

    const isCIPR = getSemanticPrefix(pr.title) === SEMANTIC_PREFIXES.CI;
    const isTestPR = getSemanticPrefix(pr.title) === SEMANTIC_PREFIXES.TEST;
    const isBuildPR = getSemanticPrefix(pr.title) === SEMANTIC_PREFIXES.BUILD;

    // CI, Test, and Build PRs do not affect Semver.
    if (isCIPR || isTestPR || isBuildPR) {
      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [SEMVER_NONE_LABEL],
      });
    }
  });
}
