import { Probot } from 'probot';
import * as nock from 'nock';

import {
    isReviewLabel,
    isSemverMajorMinorLabel,
    getPRReadyDate,
    setupAPIReviewStateManagement
} from '../src/api-review-state'
import {
    SEMVER_LABELS,
    SEMVER_NONE_LABEL,
    REVIEW_LABELS,
    MINIMUM_MINOR_OPEN_TIME,
    MINIMUM_PATCH_OPEN_TIME
  } from '../src/constants';
  

const handler = async ({ app }: { app: Probot }) => {
    setupAPIReviewStateManagement(app);
};

describe('api review',()=>{
   let robot:Probot
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
      const payload = require('./fixtures/api-review-state/pull_request.semver-none.json')

      // Set created_at to yesterday.
      payload.created_at=new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);
  
      const readyDate= getPRReadyDate(payload);
      const expectedDate= new Date(payload.created_at.getTime() + MINIMUM_PATCH_OPEN_TIME).toISOString().split('T')[0]; 

      expect(readyDate).toEqual(expectedDate);

  })

})
  