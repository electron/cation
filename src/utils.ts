import { Context } from 'probot';

const ISSUE_TEMPLATE_BASE_PATH = '.github/ISSUE_TEMPLATE/';

export async function getIssueTemplates(context: Context) {
  const { data: templatesList } = await context.github.repos.getContents(
    context.repo({
      path: ISSUE_TEMPLATE_BASE_PATH,
    }),
  );

  if (!templatesList || !Array.isArray(templatesList)) return [];

  return Promise.all(
    templatesList.map(async template => {
      const {
        data: { content },
      } = await context.github.repos.getContents(
        context.repo({
          path: ISSUE_TEMPLATE_BASE_PATH + template.name,
        }),
      );
      return Buffer.from(content, 'base64').toString();
    }),
  );
}

export const createMissingInfoComment = async (context: Context) => {
  await context.github.issues.createComment(
    context.issue({
      body:
        'Please fill out all applicable sections of the template correctly for the maintainers to be able to triage your issue.',
    }),
  );
};
