import { Probot } from 'probot';
import { DOCUMENTATION_LABEL, SEMANTIC_PREFIXES, SEMVER_LABELS, SEMVER_NONE_LABEL } from './constants';
import { addLabels } from './utils/label-utils';

export function addBasicPRLabels(probot: Probot) {
  probot.on(
    [
      'pull_request.opened',
      'pull_request.unlabeled',
      'pull_request.labeled',
      'pull_request.synchronize',
    ],
    async context => {
      const { pull_request: pr } = context.payload;

      const getSemanticPrefix = (title: string) => title.split(':')[0];
      
      // Label Docs PRs as Semver-Patch PRs.
      const isDocsPR = getSemanticPrefix(pr.title) === SEMANTIC_PREFIXES.DOCS;
      if (isDocsPR) {
        await addLabels(context.octokit, {
          ...context.repo({}),
          prNumber: pr.number,
          labels: [
            SEMVER_LABELS.PATCH,
            DOCUMENTATION_LABEL
          ],
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