import * as utils from './parse-utils';
import { Application, Context } from 'probot';

const matchTemplate = async (context: Context) => {
  const issue = context.payload.issue;
  const templates = await utils.getIssueTemplates(context);
  templates.forEach(template => {
    if (JSON.stringify(issue) === JSON.stringify(template)) {
      return template;
    }
  });
};

const triage = async (context: Context) => {
  const template = matchTemplate(context);
  // todo
};

const probotHandler = async (robot: Application) => {
  robot.on(['issue.opened', 'issue.edited'], triage);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
