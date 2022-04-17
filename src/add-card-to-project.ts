import { Probot,Context } from 'probot';
import { LogLevel } from './enums';
import { log } from './utils/log-util';

export function addCardToProject(probot: Probot) {
    probot.on("issues.opened", async (context:Context['octokit']) => {
        try {
            const { payload, octokit } = context;
            const repo = payload.repository.name;
            const owner = payload.sender.login;
            const issue_number = payload.issue.number;

            const { data: projects } = await octokit.projects.listForRepo({ owner, repo, });

            const project_obj = projects.find(
                // WARNING: This is just for trial.
                // TODO: find a way to get issue is associated tags
                (el:any) => el.name == "x-18-19"
            );
                    
            if (!project_obj) {
                // TODO: Create new project if it doesn't exist
                throw new Error("No project found!");
            }

            const project_id = project_obj.id;

            const { data: project_columns } = await octokit.projects.listColumns({ project_id,});

            const unsorted_column = project_columns.find( (el:any) => el.name == "unsorted" );

            if (!unsorted_column) {
                // TODO: Create "Unsorted column" if it doesnt exist
                throw new Error("Unsorted column doesn't exist");
            }

            
            await octokit.projects.createCard({
                column_id: unsorted_column.id, // This is the id of the Unsorted Issues column, which you'll need to get
                content_id: issue_number, // This is the issue number
                content_type: "Issue", // This will always be issue since we're associating an issue
            });
           
        } catch (err: any) {
            // TODO: Change error message to something meaningful
            log('addCardToProject', LogLevel.ERROR, `Something went wrong..`);
        }
    });
 
}
