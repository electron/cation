import * as utils from './utils';
import * as triager from './triageTemplate';

const issueParser = require('github-issue-parser');
import { Application, Context } from 'probot';
import { setUp24HourRule } from './24-hour-rule';

const validTemplateMatch = async (context: Context): Promise<string | false> => {
  const issue = context.payload.issue;
  let match: string | false = false;
  const templates = await utils.getIssueTemplates(context);
  templates.forEach(template => {
    const issueParts = Object.keys(issueParser(template));
    const templateParts = Object.keys(issueParser(issue));
    if (JSON.stringify(issueParts) === JSON.stringify(templateParts)) {
      // TODO: Turn this back on
      // match = template.name;
    }
  });

  // check for a match and complain to issue opener if none exists
  if (!match) await utils.createMissingInfoComment(context);
  return match;
};

const triage = async (context: Context) => {
  let templateComponents: Record<string, { raw: string }>;
  const templateType = await validTemplateMatch(context);
  if (templateType) {
    templateComponents = issueParser(context.payload.issue.body);
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

  setUp24HourRule(robot);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
