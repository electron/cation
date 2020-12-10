import { Context } from 'probot';
import { log } from './log-util';
import { LogLevel } from '../enums';

export const removeLabel = async (
  octokit: Context['octokit'],
  data: {
    prNumber: number;
    owner: string;
    repo: string;
    name: string;
  },
) => {
  log('removeLabel', LogLevel.INFO, `Removing ${data.name} from PR #${data.prNumber}`);

  // If the issue does not have the label, don't try remove it
  if (!(await labelExistsOnPR(octokit, data))) return;

  return octokit.issues.removeLabel({
    owner: data.owner,
    repo: data.repo,
    issue_number: data.prNumber,
    name: data.name,
  });
};

export const labelExistsOnPR = async (
  octokit: Context['octokit'],
  data: {
    prNumber: number;
    owner: string;
    repo: string;
    name: string;
  },
) => {
  log('labelExistsOnPR', LogLevel.INFO, `Checking if ${data.name} exists on #${data.prNumber}`);

  const labels = await octokit.issues.listLabelsOnIssue({
    owner: data.owner,
    repo: data.repo,
    issue_number: data.prNumber,
    per_page: 100,
    page: 1,
  });

  return labels.data.some(label => label.name === data.name);
};
