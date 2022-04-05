import { Context, Probot } from 'probot';
import {
  API_REVIEW_CHECK_NAME,
  API_WORKING_GROUP,
  EXCLUDE_LABELS,
  MINIMUM_MINOR_OPEN_TIME,
  MINIMUM_PATCH_OPEN_TIME,
  NEW_PR_LABEL,
  OWNER,
  REPO,
  REVIEW_LABELS,
  REVIEW_STATUS,
  SEMVER_LABELS,
} from './constants';
import { CheckRunStatus } from './enums';
import { isAPIReviewRequired } from './utils/check-utils';
import { getEnvVar } from './utils/env-util';
import { EventPayloads } from '@octokit/webhooks';
import { Endpoints } from '@octokit/types';
import { addLabels, removeLabel } from './utils/label-utils';

type APIApprovalState = ReturnType<typeof addOrUpdateAPIReviewCheck> extends Promise<infer T>
  ? T
  : unknown;

const checkTitles = {
  [REVIEW_LABELS.APPROVED]: 'Approved',
  [REVIEW_LABELS.DECLINED]: 'Declined',
  [REVIEW_LABELS.REQUESTED]: 'Pending',
};

const isBot = (user: string) => user === getEnvVar('BOT_USER_NAME', 'bot');
export const isReviewLabel = (label: string) => Object.values(REVIEW_LABELS).includes(label);
export const isSemverMajorMinorLabel = (label: string) =>
  [SEMVER_LABELS.MINOR, SEMVER_LABELS.MAJOR].includes(label);

/**
 * Determines the PR readiness date depending on its semver label.
 *
 * @param {EventPayloads.WebhookPayloadPullRequestPullRequest} pr
 * @returns a date corresponding to the time that must elapse before a PR requiring
 *          API review is ready to be merged according to its semver label.
 */
export const getPRReadyDate = (pr: EventPayloads.WebhookPayloadPullRequestPullRequest) => {
  let readyTime = new Date(pr.created_at).getTime();
  const isMajorMinor = pr.labels.some((l: any) => isSemverMajorMinorLabel(l.name));

  readyTime += isMajorMinor ? MINIMUM_MINOR_OPEN_TIME : MINIMUM_PATCH_OPEN_TIME;

  return new Date(readyTime).toISOString().split('T')[0];
};

export async function addOrUpdateAPIReviewCheck(
  octokit: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
) {
  const owner = pr.head.repo.owner.login;
  const repo = pr.head.repo.name;

  // Fetch the latest API Review check for the PR.
  const checkRun = (
    await octokit.checks.listForRef({
      ref: pr.head.sha,
      per_page: 100,
      owner,
      repo,
    })
  ).data.check_runs.find(run => run.name === API_REVIEW_CHECK_NAME);

  const resetToNeutral = async () => {
    if (!checkRun) return;
    return await octokit.checks.update({
      owner,
      repo,
      name: API_REVIEW_CHECK_NAME,
      status: 'completed',
      title: 'PR no longer requires API Review',
      check_run_id: checkRun.id,
      conclusion: CheckRunStatus.NEUTRAL,
    });
  };

  // We do not care about PRs without an API review label of any kind.
  const currentReviewLabel = pr.labels.find(l => Object.values(REVIEW_LABELS).includes(l.name));
  if (!currentReviewLabel) {
    await resetToNeutral();
    return;
  }

  // Fetch members of the API Working Group.
  const members = (
    await octokit.teams.listMembersInOrg({
      org: owner,
      team_slug: API_WORKING_GROUP,
    })
  ).data.map(m => m.login);

  // Filter reviews by those from members of the API Working Group.
  const reviews = (
    await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number,
    })
  ).data.filter(review => members.includes(review.user.login));

  // If the PR is semver-patch, it does not need API review.
  if (!pr.labels.some(l => isSemverMajorMinorLabel(l.name))) {
    await resetToNeutral();
    return;
  }

  const users = {
    approved: reviews.filter(review => review.body.match(/API LGTM/gi)).map(r => r.user.login),
    declined: reviews.filter(review => review.body.match(/API DECLINED/gi)).map(r => r.user.login),
    requestedChanges: reviews
      .filter(review => review.state === REVIEW_STATUS.CHANGES_REQUESTED)
      .map(r => r.user.login),
  };

  // Update the GitHub Check with appropriate API review information.
  const updateCheck = async (
    opts: Omit<
      Endpoints['POST /repos/{owner}/{repo}/check-runs']['parameters'],
      'baseUrl' | 'headers' | 'mediaType' | 'owner' | 'repo' | 'name' | 'head_sha'
    >,
  ) => {
    if (
      checkRun &&
      (checkRun.status === opts.status || !opts.status || opts.status === 'completed')
    ) {
      await octokit.checks.update({
        owner: pr.head.repo.owner.login,
        repo: pr.head.repo.name,
        name: API_REVIEW_CHECK_NAME,
        check_run_id: checkRun.id,
        ...opts,
      });
    } else {
      await octokit.checks.create({
        owner: pr.head.repo.owner.login,
        repo: pr.head.repo.name,
        name: API_REVIEW_CHECK_NAME,
        head_sha: pr.head.sha,
        ...opts,
      });
    }

    return users;
  };

  const approved = users.approved.length
    ? `#### Approved\n\n${users.approved.map(u => `* @${u}`).join('\n')}\n`
    : '';
  const requestedChanges = users.requestedChanges.length
    ? `#### Requested Changes\n\n${users.requestedChanges.map(u => `* @${u}`).join('\n')}\n`
    : '';
  const declined = users.declined.length
    ? `#### Declined\n\n${users.declined.map(u => `* @${u}`).join('\n')}\n`
    : '';

  const checkSummary = `${approved}${requestedChanges}${declined}`;

  if (currentReviewLabel.name === REVIEW_LABELS.REQUESTED) {
    return updateCheck({
      status: 'in_progress',
      output: {
        title: `${checkTitles[currentReviewLabel.name]} (${
          users.approved.length
        }/2 LGTMs - ready on ${getPRReadyDate(pr)})`,
        summary: checkSummary,
      },
    });
  } else if (currentReviewLabel.name === REVIEW_LABELS.APPROVED) {
    return updateCheck({
      status: 'completed',
      conclusion: 'success',
      output: {
        title: checkTitles[currentReviewLabel.name],
        summary: checkSummary,
      },
    });
  } else if (currentReviewLabel.name === REVIEW_LABELS.DECLINED) {
    return updateCheck({
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: checkTitles[currentReviewLabel.name],
        summary: checkSummary,
      },
    });
  }
}

/**
 * Determines whether or not a PR is ready for merge depending on API WG Reviews.
 *
 * @param {Context['octokit']} octokit
 * @param {EventPayloads.WebhookPayloadPullRequestPullRequest} pr
 * @param {APIApprovalState} userApprovalState How many users have
 *        approved/declined/requested changes for the PR.
 */
export async function checkPRReadyForMerge(
  octokit: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
  userApprovalState: APIApprovalState,
) {
  // Add or review an API review label.
  const updateAPIReviewLabel = async (newLabel: string) => {
    const currentLabel = pr.labels.find(l => Object.values(REVIEW_LABELS).includes(l.name));
    if (currentLabel && currentLabel.name !== newLabel) {
      await removeLabel(octokit, {
        owner: OWNER,
        repo: REPO,
        prNumber: pr.number,
        name: currentLabel.name,
      });
    }
    if (!currentLabel || currentLabel.name !== newLabel) {
      await addLabels(octokit, {
        owner: OWNER,
        repo: REPO,
        prNumber: pr.number,
        labels: [newLabel],
      });
    }
  };

  const isNewPR = pr.labels.some(l => l.name === NEW_PR_LABEL);
  if (!userApprovalState || isNewPR) return;

  const { approved, declined, requestedChanges } = userApprovalState;
  if (declined.length > 0) {
    await updateAPIReviewLabel(REVIEW_LABELS.DECLINED);
  } else if (approved.length >= 2 && requestedChanges.length === 0) {
    await updateAPIReviewLabel(REVIEW_LABELS.APPROVED);
  } else {
    await updateAPIReviewLabel(REVIEW_LABELS.REQUESTED);
  }
}

export function setupAPIReviewStateManagement(probot: Probot) {
  probot.on(['pull_request.synchronize', 'pull_request.opened'], async (context: Context) => {
    await addOrUpdateAPIReviewCheck(context.octokit, context.payload.pull_request);
  });

  probot.on('pull_request_review.submitted', async (context: Context) => {
    const pr = context.payload.pull_request;
    const state = await addOrUpdateAPIReviewCheck(context.octokit, pr);
    checkPRReadyForMerge(context.octokit, pr, state);
  });

  /**
   * If a potential API PR is labeled, there are several decision trees we
   * can potentially take, outlined as follows:
   *
   *  - Semver Labels:
   *    - If a semver-major or semver-minor PR is opened, API review is requisite.
   *      The api-review-requested label must be added.
   *    - If a semver-patch label is added, do not add any api-review-{state} labels and
   *      remove them if they exist.
   *  - Exclusion Labels:
   *    - If an exclusion label is added, then this PR is exempt from API review. Do not add any
   *      api-review-{state} labels and remove them if they have previously been added.
   *  - api-review-{state} labels
   *    - If any api-review-{state} label besides api-review-requested is added, remove it.
   *      API approval is controlled solely by cation.
   */
  probot.on('pull_request.labeled', async context => {
    const {
      label,
      pull_request: pr,
      repository,
      sender: { login: initiator },
    }: EventPayloads.WebhookPayloadPullRequest = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    const shouldExclude =
      pr.labels.some(l => EXCLUDE_LABELS.includes(l.name)) ||
      pr.base.ref !== pr.base.repo.default_branch ||
      label.name === SEMVER_LABELS.PATCH;

    // If a PR is semver-minor or semver-major and the PR does not have an
    // exclusion label, automatically add the 'api-review/requested 🗳' label.
    if (isSemverMajorMinorLabel(label.name) && !shouldExclude) {
      probot.log(
        'Received a semver-minor or semver-major PR:',
        `${repository.full_name}#${pr.number}`,
        "Adding the 'api-review/requested 🗳' label",
      );

      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [REVIEW_LABELS.REQUESTED],
      });
    } else if (isReviewLabel(label.name)) {
      // Humans can only add the 'api-review/requested 🗳' manually.
      if (!isBot(initiator) && label.name !== REVIEW_LABELS.REQUESTED) {
        probot.log(
          `${initiator} tried to add ${label.name} to PR #${pr.number} - this is not permitted.`,
        );

        await removeLabel(context.octokit, {
          ...context.repo({}),
          prNumber: pr.number,
          name: label.name,
        });

        return;
      }
    } else if (shouldExclude) {
      // Remove the api-review/requested label if it was added prior to an exclusion label -
      // for example if the backport label was added by trop after cation got to it.
      await removeLabel(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        name: REVIEW_LABELS.REQUESTED,
      });
    }

    await addOrUpdateAPIReviewCheck(context.octokit, pr);
  });

  /**
   * If a PR is unlabeled, we want to ensure solely that a human
   * did not remove an api-review state label other than api-review-requested.
   *
   * If they remove a semver-minor or semver-major label to replace it with a
   * semver-patch label, we'll let that get handled when they add the semver-patch
   * label.
   *
   */
  probot.on('pull_request.unlabeled', async context => {
    const {
      label,
      pull_request: pr,
      sender: { login: initiator },
    }: EventPayloads.WebhookPayloadPullRequest = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // We want to prevent tampering with api-review/* labels other than
    // request labels - the bot should control the full review lifecycle.
    if (isReviewLabel(label.name)) {
      // The 'api-review/requested 🗳' label can be removed if it does not violate requirements.
      if (label.name === REVIEW_LABELS.REQUESTED && !isAPIReviewRequired(pr)) {
        // Check will be removed by addOrUpdateCheck
      } else {
        if (!isBot(initiator)) {
          probot.log(
            `${initiator} tried to remove ${label.name} from PR #${pr.number} - this is not permitted.`,
          );

          await addLabels(context.octokit, {
            ...context.repo({}),
            prNumber: pr.number,
            labels: [label.name],
          });

          return;
        }
      }

      await addOrUpdateAPIReviewCheck(context.octokit, pr);
    }
  });
}
