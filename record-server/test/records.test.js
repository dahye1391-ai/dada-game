import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker from '../src/index.js';

const origin = 'https://dahye1391-ai.github.io';
const record = () => ({id: randomUUID(), name:'다혜', difficulty:'normal', result:'win', durationSeconds:120, blackScore:40, whiteScore:24});
function binding(path = ':memory:') {
 const db = new DatabaseSync(path);
 return {close: () => db.close(), exec: async sql => {db.exec(sql);}, prepare(sql) {
  const statement = db.prepare(sql);
  const query = (...args) => ({
   bind: (...bound) => query(...bound),
   all: async () => ({results: statement.all(...args)}),
   first: async () => statement.get(...args) || null,
   run: async () => ({meta: {changes: Number(statement.run(...args).changes)}})
  });
  return query();
 }};
}
function request(method='GET',data,options={}) {
 return new Request('https://records.test/api/othello/scores',{
  method, headers: {'Origin':origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...options.headers},
  ...(data===undefined?{}:{body:typeof data==='string'?data:JSON.stringify(data)}),...options
 });
}
const send = (DB,method,data,options) => worker.fetch(request(method,data,options),{DB});

test('stores the exact record; lists it with CORS; retries are idempotent',async t=>{
 const DB=binding();t.after(()=>DB.close());const match=record();
 const empty=await send(DB);assert.deepEqual(await empty.json(),{scores:[]});
 const first=await send(DB,'POST',match);assert.equal(first.status,201);assert.equal(first.headers.get('Access-Control-Allow-Origin'),origin);
 const saved=(await first.json()).score;assert.ok(saved.createdAt);
 for(const key of Object.keys(match))assert.equal(saved[key],match[key]);
 assert.equal((await send(DB,'POST',match)).status,200);
 assert.equal((await send(DB,'POST',{...match,name:'다른 이름'})).status,409);
 assert.equal((await (await send(DB)).json()).scores.length,1);
});
test('persists after reopening the database and returns latest 100',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'dada-records-')),path=join(dir,'records.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let DB=binding(path);let last;
 for(let i=0;i<103;i++){last={...record(),name:'친구'+i};assert.equal((await send(DB,'POST',last)).status,201);}
 DB.close();DB=binding(path);t.after(()=>DB.close());
 const scores=(await (await send(DB)).json()).scores;assert.equal(scores.length,100);assert.equal(scores[0].id,last.id);assert.equal(scores.at(-1).name,'친구3');
});
test('rejects invalid names, scores, durations, results and ids without saving',async t=>{
 const DB=binding();t.after(()=>DB.close());
 for(const patch of [{name:''},{name:' '.repeat(3)},{name:'아'.repeat(17)},{name:'a\nb'},{difficulty:'expert'},{result:'loss'},{durationSeconds:-1},{durationSeconds:1.5},{durationSeconds:86401},{blackScore:65},{whiteScore:-1},{blackScore:30,whiteScore:20,result:'draw'},{id:'fake-id'}]){
  assert.equal((await send(DB,'POST',{...record(),...patch})).status,400,JSON.stringify(patch));
 }
 assert.equal((await send(DB,'POST','{')).status,400);
 assert.equal((await send(DB,'POST','x'.repeat(2049))).status,413);
 assert.equal((await send(DB,'POST',null)).status,400);
 assert.deepEqual(await (await send(DB)).json(),{scores:[]});
});
test('normalizes names and accepts draws, losses and zero-second matches',async t=>{
 const DB=binding();t.after(()=>DB.close());
 for(const match of [{...record(),name:'  다혜  '},{...record(),result:'draw',blackScore:32,whiteScore:32,durationSeconds:0},{...record(),result:'loss',blackScore:12,whiteScore:52}])assert.equal((await send(DB,'POST',match)).status,201);
 const rows=(await (await send(DB)).json()).scores;assert.equal(rows.at(-1).name,'다혜');
});
test('preflight, origin restrictions, unsupported methods and unavailable DB',async t=>{
 const DB=binding();t.after(()=>DB.close());
 const preflight=await send(DB,'OPTIONS');assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
 const bad=new Request('https://records.test/api/othello/scores',{headers:{Origin:'https://unrelated.test'}});
 assert.equal((await worker.fetch(bad,{DB})).status,403);
 assert.equal((await send(DB,'DELETE')).status,405);
 assert.equal((await send(DB,'POST',record(),{headers:{'Content-Type':'text/plain',Origin:origin}})).status,415);
 assert.equal((await send(undefined)).status,503);
 const broken={prepare:()=>({run:async()=>{throw Error('database error')}})};
 const unavailable=await send(broken);assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('Access-Control-Allow-Origin'),origin);
 assert.equal((await worker.fetch(new Request('https://records.test/unknown'),{DB})).status,404);
});
