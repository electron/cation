import { Context } from 'probot';
import { ApiResponse } from './probot';
import { MISSING_INFO_LABEL } from './constants';

const ISSUE_TEMPLATE_BASE_PATH = '.github/ISSUE_TEMPLATE/';

export async function getIssueTemplates(context: Context): Promise<ApiResponse[] | []> {
  const contents = await context.github.repos.getContents(
    context.repo({
      path: ISSUE_TEMPLATE_BASE_PATH,
    }),
  );

  const templatesList: ApiResponse = contents.data;
  if (!templatesList || !Array.isArray(templatesList)) return [];

  return Promise.all(
    templatesList.map(async template => {
      const contents = await context.github.repos.getContents(
        context.repo({
          path: ISSUE_TEMPLATE_BASE_PATH + template.name,
        }),
      );
      const templateContent: ApiResponse = contents.data;
      return templateContent;
    }),
  );
}

export const arrayContainsArray = (superset: string[], subset: string[]) => {
  return subset.every(value => {
    return superset.indexOf(value) >= 0;
  });
};

export const notifyMissingInfo = async (context: Context, missingValues?: string[]) => {
  let body;
  if (missingValues) {
    body = `Please fill out all applicable sections of the template
    correctly for the maintainers to be able to triage your issue. 
    You seem to be missing: ${missingValues.join(' ')}.`;
  } else {
    body = `Please fill out all applicable sections of the template
    correctly for the maintainers to be able to triage your issue.`;
  }
  await context.github.issues.createComment(context.issue({ body }));
  await context.github.issues.addLabels(
    context.repo({
      number: context.payload.pull_request.number,
      labels: [MISSING_INFO_LABEL],
    }),
  );
};

export const addIssueLabels = async (labelsToAdd: string[], context: Context) => {
  await context.github.issues.addLabels(
    context.repo({
      number: context.payload.issue.number,
      labels: labelsToAdd,
    }),
  );
};

export const createNoMatchComment = async (context: Context) => {
  await context.github.issues.createComment(
    context.issue({
      body: `Your issue doesn't seem to match one of our existing templates.
Please open an issue matching a template in order for your issue to be triaged by a maintainer.`,
    }),
  );
};
