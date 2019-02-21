import * as utils from './parse-utils';
import * as triager from './triageTemplate';

const issueParser = require('github-issue-parser');
import { Application, Context } from 'probot';

const validTemplateMatch = async (context: Context): Promise<string | false> => {
  const issue = context.payload.issue;
  let match: string | false = false;
  const templates = await utils.getIssueTemplates(context);
  templates.forEach(template => {
    const issueParts = Object.keys(issueParser(template));
    const templateParts = Object.keys(issueParser(issue));
    if (JSON.stringify(issueParts) === JSON.stringify(templateParts)) {
      match = template.name;
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
  let templateComponents: string[];
  const templateType = await validTemplateMatch(context);
  if (templateType) {
    templateComponents = issueParser(context.payload.issue);
    switch (templateType) {
      case 'bug_report.md':
        await triager.triageBugReport(templateComponents, context);
      case 'feature_request.md':
        await triager.triageFeatureRequest(templateComponents, context);
      case 'mac_app_store_private_api_rejection.md':
        await triager.triageMASRejection(templateComponents, context);
      default:
        console.log('template was not a triagable template');
    }
  }
};

const probotHandler = async (robot: Application) => {
  robot.on(['issue.opened', 'issue.edited'], triage);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
