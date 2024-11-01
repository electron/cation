import { Context, Probot } from 'probot';
import { log } from './utils/log-util';
import {
  API_REVIEW_CHECK_NAME,
  API_SKIP_DELAY_LABEL,
  API_WORKING_GROUP,
  EXCLUDE_LABELS,
  MINIMUM_MINOR_OPEN_TIME,
  MINIMUM_PATCH_OPEN_TIME,
  NEW_PR_LABEL,
  OWNER,
  REPO,
  REVIEW_LABELS,
  SEMVER_LABELS,
} from './constants';
import { CheckRunStatus, LogLevel } from './enums';
import { isAPIReviewRequired } from './utils/check-utils';
import { getEnvVar } from './utils/env-util';
import { PullRequest, Label } from '@octokit/webhooks-types';
import { GetResponseDataTypeFromEndpointMethod, Endpoints } from '@octokit/types';
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
export const hasSemverMajorMinorLabel = (pr: PullRequest) =>
  pr.labels.some((l) => isSemverMajorMinorLabel(l.name));
export const hasAPIReviewRequestedLabel = (pr: PullRequest) =>
  pr.labels.some((l) => l.name === REVIEW_LABELS.REQUESTED);

/**
 * Determines the PR readiness date depending on its semver label.
 *
 * @returns a date corresponding to the time that must elapse before a PR requiring
 *          API review is ready to be merged according to its semver label.
 */
export const getPRReadyDate = (pr: PullRequest) => {
  let readyTime = new Date(pr.created_at).getTime();

  if (!pr.labels.some((l) => l.name === API_SKIP_DELAY_LABEL)) {
    const isMajorMinor = pr.labels.some((l) => isSemverMajorMinorLabel(l.name));
    readyTime += isMajorMinor ? MINIMUM_MINOR_OPEN_TIME : MINIMUM_PATCH_OPEN_TIME;
  }

  return new Date(readyTime).toISOString().split('T')[0];
};

export async function addOrUpdateAPIReviewCheck(octokit: Context['octokit'], pr: PullRequest) {
  log('addOrUpdateAPIReviewCheck', LogLevel.INFO, `Validating ${pr.number} by ${pr.user.login}`);

  type ListReviewsItem = GetResponseDataTypeFromEndpointMethod<typeof octokit.pulls.listReviews>[0];

  type ListCommentsItem = GetResponseDataTypeFromEndpointMethod<
    typeof octokit.issues.listComments
  >[0];

  type CommentOrReview = ListReviewsItem & ListCommentsItem;

  const fork = pr.head.repo.fork;
  const owner = pr.base.repo.owner.login;
  const repo = pr.head.repo.name;

  if (fork) {
    log(
      'addOrUpdateAPIReviewCheck',
      LogLevel.INFO,
      `${pr.number} is a fork - checks will not be created or updated`,
    );
  }

  // Fetch the latest API Review check for the PR.
  const checkRun = fork
    ? null
    : (
        await octokit.checks.listForRef({
          ref: pr.head.sha,
          per_page: 100,
          owner,
          repo,
        })
      ).data.check_runs.find((run) => run.name === API_REVIEW_CHECK_NAME);

  const resetToNeutral = async () => {
    if (!checkRun) return;
    const params: Endpoints['PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}']['parameters'] =
      {
        owner,
        repo,
        name: API_REVIEW_CHECK_NAME,
        status: 'completed',
        output: {
          title: 'Outdated',
          summary: 'PR no longer requires API Review',
        },
        check_run_id: checkRun.id,
        conclusion: CheckRunStatus.NEUTRAL,
      };
    return await octokit.checks.update(params);
  };

  // We do not care about PRs without an API review label of any kind.
  const currentReviewLabel = pr.labels.find((l) => Object.values(REVIEW_LABELS).includes(l.name));
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
  ).data.map((m) => m.login);

  log(
    'addOrUpdateAPIReviewCheck',
    LogLevel.INFO,
    `Fetched ${members.length} API Review WG members`,
  );

  // Filter reviews by those from members of the API Working Group.
  const reviews = (
    await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number,
    })
  ).data.filter(({ user, body }) => {
    return members.includes(user!.login) && body.length !== 0;
  });

  log(
    'addOrUpdateAPIReviewCheck',
    LogLevel.INFO,
    `Found ${reviews.length} API review(s) from WG members`,
  );

  // Filter comments by those from members of the API Working Group.
  const comments = (
    await octokit.issues.listComments({
      owner,
      repo,
      issue_number: pr.number,
    })
  ).data.filter(({ user }) => members.includes(user!.login));

  log(
    'addOrUpdateAPIReviewCheck',
    LogLevel.INFO,
    `Found ${comments.length} API review comment(s) from WG members`,
  );

  const lgtm = /API LGTM/i;
  const decline = /API DECLINED/i;
  const changesRequested = /API CHANGES REQUESTED/i;

  // Combine reviews/comments and filter by recency.
  const filtered = ([...comments, ...reviews] as CommentOrReview[]).reduce((items, item) => {
    if (!item?.body || !item.user) return items;

    const reviewComment =
      lgtm.test(item.body) || decline.test(item.body) || changesRequested.test(item.body);
    if (!reviewComment) return items;

    const prev = items[item.user.id];
    if (!prev) {
      items[item.user.id] = item;
      return items;
    }

    const isReview = (item: CommentOrReview) => {
      return item.submitted_at !== undefined;
    };

    const prevDate = isReview(prev) ? new Date(prev.submitted_at!) : new Date(prev.updated_at);
    const currDate = isReview(item) ? new Date(item.submitted_at!) : new Date(item.updated_at);
    if (prevDate.getTime() < currDate.getTime()) {
      items[item.user.id] = item;
    }

    return items;
  }, {} as Record<string, CommentOrReview>);

  const allReviews = Object.values(filtered);

  log(
    'addOrUpdateAPIReviewCheck',
    LogLevel.INFO,
    `Found ${allReviews.length} relevant reviews from WG members`,
  );

  // If the PR is semver-patch, it does not need API review.
  if (!pr.labels.some((l) => isSemverMajorMinorLabel(l.name))) {
    log(
      'addOrUpdateAPIReviewCheck',
      LogLevel.INFO,
      'Determined this PR is semver-patch and does not need review',
    );
    await resetToNeutral();
    return;
  }

  const approved = allReviews.filter((r) => r.body?.match(lgtm)).map((r) => r.user?.login);
  const declined = allReviews.filter((r) => r.body?.match(decline)).map((r) => r.user?.login);
  const requestedChanges = allReviews
    .filter((r) => r.body?.match(changesRequested))
    .map((r) => r.user?.login);

  log(
    'addOrUpdateAPIReviewCheck',
    LogLevel.INFO,
    `PR ${pr.number} has ${approved.length} API LGTMs, ${declined.length} API DECLINEDs, and ${requestedChanges.length} API CHANGES REQUESTED`,
  );

  const users = { approved, declined, requestedChanges };

  // If the PR is a fork PR, return early as the Checks API doesn't work.
  if (fork) return users;

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

  const approvedString = users.approved.length
    ? `#### Approved\n\n${users.approved.map((u) => `* @${u}`).join('\n')}\n`
    : '';
  const requestedChangesString = users.requestedChanges.length
    ? `#### Requested Changes\n\n${users.requestedChanges.map((u) => `* @${u}`).join('\n')}\n`
    : '';
  const declinedString = users.declined.length
    ? `#### Declined\n\n${users.declined.map((u) => `* @${u}`).join('\n')}\n`
    : '';

  const checkSummary = `${approvedString}${requestedChangesString}${declinedString}`;

  if (currentReviewLabel.name === REVIEW_LABELS.REQUESTED) {
    log(
      'addOrUpdateAPIReviewCheck',
      LogLevel.INFO,
      `Marking Check for ${pr.number} as API requested`,
    );
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
    log('addOrUpdateAPIReviewCheck', LogLevel.INFO, `Marking Check for ${pr.number} as API LGTM`);
    return updateCheck({
      status: 'completed',
      conclusion: 'success',
      output: {
        title: checkTitles[currentReviewLabel.name],
        summary: checkSummary,
      },
    });
  } else if (currentReviewLabel.name === REVIEW_LABELS.DECLINED) {
    log(
      'addOrUpdateAPIReviewCheck',
      LogLevel.INFO,
      `Marking Check for ${pr.number} as API DECLINED`,
    );
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
 * @param userApprovalState - How many users have
 *        approved/declined/requested changes for the PR.
 */
export async function checkPRReadyForMerge(
  octokit: Context['octokit'],
  pr: PullRequest,
  userApprovalState: APIApprovalState,
) {
  log('checkPRReadyForMerge', LogLevel.INFO, `Checking if ${pr.number} is ready for merge`);

  // Add or review an API review label.
  const updateAPIReviewLabel = async (newLabel: string) => {
    const currentLabel = pr.labels.find((l) => Object.values(REVIEW_LABELS).includes(l.name));
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

  const isNewPR = pr.labels.some((l: Label) => l.name === NEW_PR_LABEL);
  if (!userApprovalState || isNewPR) return;

  const { approved, declined, requestedChanges } = userApprovalState;
  if (declined.length > 0) {
    log('checkPRReadyForMerge', LogLevel.INFO, `Marking ${pr.number} as API declined`);
    await updateAPIReviewLabel(REVIEW_LABELS.DECLINED);
  } else if (approved.length >= 2 && requestedChanges.length === 0) {
    log('checkPRReadyForMerge', LogLevel.INFO, `Marking ${pr.number} as API approved`);
    await updateAPIReviewLabel(REVIEW_LABELS.APPROVED);
  } else {
    log('checkPRReadyForMerge', LogLevel.INFO, `Marking ${pr.number} as API review requested`);
    await updateAPIReviewLabel(REVIEW_LABELS.REQUESTED);
  }
}

export function setupAPIReviewStateManagement(probot: Probot) {
  /**
   * If a PR is opened or synchronized, we want to ensure the
   * API review check is up-to-date.
   */
  probot.on(
    ['pull_request.synchronize', 'pull_request.opened'],
    async (context: Context<'pull_request'>) => {
      await addOrUpdateAPIReviewCheck(context.octokit, context.payload.pull_request);
    },
  );

  /**
   * If a PR review is submitted, we want to ensure the API
   * review check is up-to-date.
   */
  probot.on(
    'pull_request_review.submitted',
    async (context: Context<'pull_request_review.submitted'>) => {
      const pr = context.payload.pull_request as PullRequest;
      const state = await addOrUpdateAPIReviewCheck(context.octokit, pr);
      await checkPRReadyForMerge(context.octokit, pr, state);
    },
  );

  /**
   * If a PR with API review requirements is marked ready for review,
   * we want to add the 'api-review/requested 🗳' label.
   */
  probot.on('pull_request.ready_for_review', async (context: Context<'pull_request'>) => {
    const { pull_request: pr, repository } = context.payload;

    if (hasSemverMajorMinorLabel(pr)) {
      probot.log(
        'semver-minor or semver-major PR:',
        `${repository.full_name}#${pr.number}`,
        'was marked as ready for review',
        "Adding the 'api-review/requested 🗳' label",
      );

      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [REVIEW_LABELS.REQUESTED],
      });
    }
  });

  /**
   * If a PR with existing API review requirements is converted to draft status,
   * we want to remove the 'api-review/requested 🗳' label.
   */
  probot.on('pull_request.converted_to_draft', async (context: Context<'pull_request'>) => {
    const { pull_request: pr, repository } = context.payload;

    if (hasSemverMajorMinorLabel(pr) && hasAPIReviewRequestedLabel(pr)) {
      probot.log(
        'semver-minor or semver-major PR:',
        `${repository.full_name}#${pr.number}`,
        'was converted to draft status',
        "Removing the 'api-review/requested 🗳' label",
      );

      await removeLabel(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        name: REVIEW_LABELS.REQUESTED,
      });
    }
  });

  /**
   * If a potential API PR is labeled, there are several decision trees we
   * can potentially take, outlined as follows:
   *
   *  - Semver Labels:
   *    - If a semver-major or semver-minor PR is opened, API review is required.
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
  probot.on('pull_request.labeled', async (context: Context<'pull_request.labeled'>) => {
    const {
      label,
      pull_request: pr,
      repository,
      sender: { login: initiator },
    } = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // It's permissible to change labels on merged or draft PRs.
    if (pr.merged || pr.draft) return;

    // Exclude PRs from API review if they:
    // 1) Have backport, backport-skip, or fast-track labels
    // 2) Are targeting a non-main branch
    // 3) Are semver-patch PRs
    // 4) Are draft PRs
    const excludePR =
      pr.labels.some((l) => EXCLUDE_LABELS.includes(l.name)) ||
      pr.base.ref !== pr.base.repo.default_branch ||
      label.name === SEMVER_LABELS.PATCH ||
      pr.draft;

    // If a PR is semver-minor or semver-major and the PR does not have an
    // exclusion condition, automatically add the 'api-review/requested 🗳' label.
    if (isSemverMajorMinorLabel(label.name) && !excludePR) {
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

      // If the human-added label is an approve/decline API review label
      // remove it.
    } else if (isReviewLabel(label.name)) {
      if (!isBot(initiator) && label.name !== REVIEW_LABELS.REQUESTED) {
        probot.log(
          `${initiator} tried to add ${label.name} to PR #${pr.number} - this is not permitted.`,
        );

        await removeLabel(context.octokit, {
          ...context.repo({}),
          prNumber: pr.number,
          name: label.name,
        });
      }
      // Remove the api-review/requested 🗳' label if it was added prior to an exclusion label -
      // for example if the backport label was added by trop after cation got to it.
    } else if (excludePR) {
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
  probot.on('pull_request.unlabeled', async (context: Context<'pull_request.unlabeled'>) => {
    const {
      label,
      pull_request: pr,
      sender: { login: initiator },
    } = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // Once a PR is merged, allow tampering.
    if (pr.merged) return;

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
