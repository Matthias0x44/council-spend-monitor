import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyService} from '../src/lib/classifier';
const review=JSON.parse(fs.readFileSync('tests/fixtures/service-review.json','utf8')) as {fixtures:{service:string;directorate:string;category:string;expected:string}[]};
test('real source-label diagnostic set: emitted labels agree with reviewed service meaning',()=>{
 let classified=0;
 for(const row of review.fixtures){const result=classifyService(row);if(result.method==='rule'){classified++;assert.equal(result.label,row.expected,JSON.stringify(row));}}
 assert.ok(classified>=10,'rules must resolve a useful subset');
});
test('broad mixed directorates and negated phrases cannot create false certainty',()=>{
 assert.equal(classifyService({service:'Education and Children services'}).method,'unresolved');
 assert.equal(classifyService({description:'Please send invoice'}).method,'unresolved');
 assert.equal(classifyService({description:'Not public health'}).method,'unresolved');
 assert.equal(classifyService({directorate:'Division: Adult Services and Housing'}).method,'unresolved');
 assert.equal(classifyService({description:'Learning disabilities'}).method,'unresolved');
 assert.equal(classifyService({service:'Childrens & Educational Services',category:'Education Services'}).label,'Education');
});
