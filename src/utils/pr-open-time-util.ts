import { ProbotOctokit } from 'probot';
import { PullRequest } from '../types';

/**
 * @param octokit - An Octokit instance
 * @returns a number representing the that cation should use as the
 * open time for the PR in milliseconds, taking draft status into account.
 */
export const getPROpenedTime = async (octokit: ProbotOctokit, pr: PullRequest): Promise<number> => {
  const [owner, repo] = pr.base.repo.full_name.split('/');

  // Fetch PR timeline events.
  const { data: events } = await octokit.rest.issues.listEventsForTimeline({
    owner,
    repo,
    issue_number: pr.number,
  });

  // Filter out all except 'Ready For Review' events.
  const readyForReviewEvents = events
    .filter((e) => e.event === 'ready_for_review')
    .sort((cA, cB) => {
      if (!('created_at' in cA) || !('created_at' in cB)) return 0;
      return new Date(cB.created_at).getTime() - new Date(cA.created_at).getTime();
    });

  // If this PR was a draft PR previously, set its opened time as a function
  // of when it was most recently marked ready for review instead of when it was opened,
  // otherwise return the PR open date.
  const firstEvent = readyForReviewEvents[0];
  const validFirstEvent = firstEvent && 'created_at' in firstEvent;

  return validFirstEvent
    ? new Date(firstEvent.created_at).getTime()
    : new Date(pr.created_at).getTime();
};
