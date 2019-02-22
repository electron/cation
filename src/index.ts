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
    const templateBody: string = Buffer.from(template.content, 'base64').toString();
    const templateParts = Object.keys(issueParser(templateBody));
    const issueParts = Object.keys(issueParser(issue.body));
    let optional: string[] = [];

    switch (template.name) {
      case 'bug_report.md':
        optional = [
          'Last known working Electron version:',
          'To Reproduce',
          'Screenshots',
          'Additional Information',
        ];
        break;
      case 'feature_request.md':
        optional = ['Additional context'];
        break;
      case 'mac-app-store-private-api-rejection.md':
        optional = ['Additional context'];
        break;
      default:
      // fallthrough
    }

    const required: string[] = templateParts.filter(key => !optional.includes(key));
    if (utils.arrayContainsArray(issueParts, required)) {
      match = template.name;
    }
  });

  // check for a match and complain to issue opener if none exists
  if (!match) await utils.createNoMatchComment(context);
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
        break;
      case 'feature_request.md':
        await triager.triageFeatureRequest(templateComponents, context);
        break;
      case 'mac_app_store_private_api_rejection.md':
        await triager.triageMASRejection(templateComponents, context);
        break;
      default:
        console.log('template was not a triagable template');
    }
  }
};

const probotHandler = async (robot: Application) => {
  robot.on(['issues.opened', 'issues.edited', 'issues.reopened'], triage);

  setUp24HourRule(robot);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
