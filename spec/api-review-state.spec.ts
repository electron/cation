import { Context, Probot } from 'probot';
import * as nock from 'nock';

import {
    isReviewLabel,
    isSemverMajorMinorLabel,
    getPRReadyDate,
    setupAPIReviewStateManagement,
    addOrUpdateAPIReviewCheck
} from '../src/api-review-state'
import {
    SEMVER_LABELS,
    SEMVER_NONE_LABEL,
    REVIEW_LABELS,
    MINIMUM_MINOR_OPEN_TIME,
    MINIMUM_PATCH_OPEN_TIME,
    API_REVIEW_CHECK_NAME

  } from '../src/constants';
  
import { CheckRunStatus } from '../src/enums';

const handler = async ({ app }: { app: Probot }) => {
    setupAPIReviewStateManagement(app);
};

describe('api review',()=>{
   let robot:Probot;
   beforeEach(()=>{
       nock.disableNetConnect();
       robot = new Probot({
        githubToken: 'test',
        secret: 'secret',
        privateKey: 'private key',
        id: 690857,
      });

      robot.load(handler);


   })
   afterEach(() => {
    nock.cleanAll()
  })
  it('should returns true for review lables',()=>{
     expect(isReviewLabel(REVIEW_LABELS.APPROVED)).toEqual(true)
     expect(isReviewLabel(REVIEW_LABELS.DECLINED)).toEqual(true)
     expect(isReviewLabel(REVIEW_LABELS.REQUESTED)).toEqual(true)
  })

  it('should returns true for semver-major and semver-minor label',()=>{

    expect(isSemverMajorMinorLabel(SEMVER_LABELS.MAJOR)).toEqual(true)
    expect(isSemverMajorMinorLabel(SEMVER_LABELS.MINOR)).toEqual(true)
    
       
  })
  it('should returns false for any other labels',()=>{

    expect(isSemverMajorMinorLabel(SEMVER_LABELS.PATCH)).toEqual(false)
    expect(isReviewLabel(SEMVER_LABELS.MAJOR)).toEqual(false)
       
  })

  it('correctly returns PR ready date for semver-major/semver-minor labels',async ()=>{
      const payload = require('./fixtures/api-review-state/pull_request.semver-minor.json')

      // Set created_at to yesterday.
      payload.created_at=new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);
  
      const readyDate= getPRReadyDate(payload);
      const expectedDate= new Date(payload.created_at.getTime() +  MINIMUM_MINOR_OPEN_TIME).toISOString().split('T')[0];

      expect(readyDate).toEqual(expectedDate);

  })
  it('correctly returns PR ready date when semver-major/semver-minor labels not found',async ()=>{
      const payload = require('./fixtures/api-review-state/pull_request.semver-patch.json')

      // Set created_at to yesterday.
      payload.created_at=new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);
  
      const readyDate= getPRReadyDate(payload);
      const expectedDate= new Date(payload.created_at.getTime() + MINIMUM_PATCH_OPEN_TIME).toISOString().split('T')[0]; 

      expect(readyDate).toEqual(expectedDate);

  })

  it(`correctly update api review check when no ${REVIEW_LABELS} found`,async ()=>{
    const payload = require('./fixtures/api-review-state/pull_request.no_review_label.json');

    nock('https://api.github.com')
    .get(`/repos/electron/electron/commits/${payload.pull_request.head.sha}/check-runs?per_page=100`)
    .reply(200, { check_runs: [{
          name:API_REVIEW_CHECK_NAME,
          id:payload.id
    }]
                    });

    const expected = {
      name: API_REVIEW_CHECK_NAME,
      status: 'completed',
      output: {
        
        title: 'PR no longer requires API Review'
      },
      conclusion: CheckRunStatus.NEUTRAL
    };


    nock('https://api.github.com')
    .patch(`/repos/electron/electron/check-runs/${payload.id}`, body => {
      expect(body).toMatchObject(expected)
      return true;
    })
    .reply(200);
    
      await robot.receive({
        id: '123-456',
        name: 'pull_request',
        payload,
      });
  
      
  
    })      
})
