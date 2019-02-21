import { Application, Context } from 'probot';
const issueParser = require('github-issue-parser');

const ISSUE_TEMPLATE_BASE_PATH = '.github/ISSUE_TEMPLATE/';

export async function getIssueTemplates (context: Context) {
  const {data: templatesList} = await context.github.repos.getContents(
    context.repo({
      path: ISSUE_TEMPLATE_BASE_PATH
    })
  )

  if (!templatesList || !Array.isArray(templatesList)) return []

  return Promise.all(templatesList.map(async template => {
    const {data: {content}} = await context.github.repos.getContents(
      context.repo({
        path: ISSUE_TEMPLATE_BASE_PATH + template.name
      })
    )
    return Buffer.from(content, 'base64').toString()
  }))
}
