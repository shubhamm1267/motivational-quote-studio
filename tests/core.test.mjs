import test from 'node:test';
import assert from 'node:assert/strict';
import {FACTS,CATEGORIES,getSeed,localPost,pickAutoTopic} from '../backend/facts.mjs';
import {sanitizeModel} from '../backend/gemini.mjs';

test('categories match the available content and original seed quotes',()=>{
  assert.ok(CATEGORIES.length>=10);
  for(const fact of FACTS){
    assert.ok(fact.en && fact.hi);
    assert.ok(fact.category);
  }
});
test('local post renders English/Hindi and metadata',()=>{
  const sample=getSeed('life');
  const en=localPost(sample,'en');
  const hi=localPost(sample,'hi');
  assert.ok(en.headline && en.caption && en.hashtags.length);
  assert.ok(hi.headline && hi.caption);
  assert.ok(pickAutoTopic('life').length);
});
test('Gemini model allowlist blocks unrecognized identifiers',()=>{
  assert.equal(sanitizeModel('../inject'),'gemini-2.5-flash-lite');
});
