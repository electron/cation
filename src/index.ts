import * as utils from './parse-utils';
const issueParser = require('github-issue-parser');
import { Application, Context } from 'probot';

const getValidMatch = async (context: Context): Promise<string | null> => {
  const issue = context.payload.issue;
  let match: string | null = null;
  const templates = await utils.getIssueTemplates(context);
  templates.forEach(template => {
    if (JSON.stringify(issue) === JSON.stringify(template)) {
      match = template;
    }
  });

  // check for a match and complain to issue opener if none exists
  if (!match) {
    await context.github.issues.createComment(
      context.issue({
        body:
          'It seems that you did not fill out a valid issue template. \
        Please fill out all applicable fields in the template correctly for the \
        maintainers to be able to triage your issue.',
      }),
    );
  }
  return match;
};

const triage = async (context: Context) => {
  const template = getValidMatch(context);
};

const probotHandler = async (robot: Application) => {
  robot.on(['issue.opened', 'issue.edited'], triage);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
