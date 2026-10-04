import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, submit, defaultAction} from '../src/domain/engine.js';
import {observe} from '../src/domain/visibility.js';
import {PRESETS} from '../src/domain/resources.js';

function game(n=12) { return createGame({count:n,seed:42}); }
function role(s:any,r:string){return s.players.find((p:any)=>p.role===r).seat;}
function act(s:any,seat:number,action:any){const v=observe(s,seat);return submit(s,seat,{commandId:`${s.version}-${seat}`,windowId:v.windowId!,action});}
function finish(s:any, choice:(s:any,seat:number)=>any=()=>null){const kind=s.phase;let guard=0;while(s.phase===kind&&s.outcome===null){assert.ok(++guard<100);const seat=s.window.actors.find((i:number)=>!(String(i) in s.window.answers));const a=choice(s,seat)??defaultAction(observe(s,seat));s=act(s,seat,a);}return s;}
function day(s:any){while(s.phase!=='discussion'&&!s.outcome)s=finish(s);return s;}

test('all presets produce one human and the literal classic role counts',()=>{
 for(let n=6;n<=14;n++){const s=game(n);assert.equal(s.players.length,n);assert.equal(s.players.filter(p=>p.actor==='human').length,1);}
 assert.deepEqual(PRESETS.find(p=>p.count===12)?.roles,{wolf:4,villager:4,seer:1,witch:1,hunter:1,idiot:1});
});
test('sealed wolf submissions do not change other wolf view or invalidate their window',()=>{
 let s=game();const wolves=s.players.filter(p=>p.role==='wolf').map(p=>p.seat);const before=observe(s,wolves[1]);
 s=act(s,wolves[0],{type:'wolfVote',targetSeat:2});
 assert.deepEqual(observe(s,wolves[1]),before);
 assert.equal(observe(s,role(s,'villager')).phase,'night');
 assert.ok(!JSON.stringify(observe(s,role(s,'villager'))).includes('wolfVote'));
});
test('witch cannot self save and cannot use both potions',()=>{
 let s=game();const w=role(s,'witch');s=finish(s,()=>({type:'wolfVote',targetSeat:w}));s=finish(s);
 assert.equal(s.phase,'witchUse');
 assert.throws(()=>act(s,w,{type:'witchUse',mode:'save',targetSeat:w}),/INVALID_TARGET/);
 assert.throws(()=>act(s,w,{type:'witchUse',mode:'both',targetSeat:2}),/INVALID_PAYLOAD/);
 assert.equal(s.abilities[w].save,true);
});
test('poisoned hunter never receives a gun window and public dawn omits cause',()=>{
 let s=game(8);const h=role(s,'hunter'),w=role(s,'witch');s=finish(s);s=finish(s);s=act(s,w,{type:'witchUse',mode:'poison',targetSeat:h});
 assert.notEqual(s.phase,'hunterShoot');assert.equal(s.players[h-1].alive,false);
 const text=JSON.stringify(observe(s,role(s,'villager')));assert.ok(!text.includes('poison'));assert.equal(s.players[h-1].revealedRole,null);
});
test('final god hunter fires before edge victory and eliminates last wolf',()=>{
 let s=game(8);const h=role(s,'hunter');const wolf=role(s,'wolf');
 for(const p of s.players)if((p.role==='wolf'&&p.seat!==wolf)||(p.role==='seer'||p.role==='witch'))p.alive=false;
 s.night.alive=s.players.filter(p=>p.alive).map(p=>p.seat);s.window.actors=[wolf];s=act(s,wolf,{type:'wolfVote',targetSeat:h});
 assert.equal(s.phase,'hunterShoot');assert.equal(s.outcome,null);
 s=act(s,h,{type:'hunterShoot',targetSeat:wolf});assert.equal(s.outcome?.status,'good_win');
});
test('white idiot reveal removes both voting and exile eligibility',()=>{
 let s=day(game());s=finish(s);const i=role(s,'idiot');s=finish(s,(_s,seat)=>({type:'exileVote',targetSeat:seat===i?null:i}));
 assert.equal(s.players[i-1].alive,true);assert.equal(s.players[i-1].voteEligible,false);assert.equal(s.players[i-1].exileEligible,false);assert.equal(s.players[i-1].revealedRole,'idiot');
});
test('second exile tie ends day without an infinite PK',()=>{
 let s=day(game(6));s=finish(s);const [a,b]=s.players.filter((p:any)=>p.alive).map((p:any)=>p.seat);
 s=finish(s,(_s,seat)=>({type:'exileVote',targetSeat:seat===a?b:seat===b?a:null}));assert.equal(s.phase,'pkSpeech');s=finish(s);s=finish(s);
 assert.equal(s.phase,'wolfVote');assert.equal(s.day,2);
});
test('sheriff election excludes original candidates from voters and single candidate wins',()=>{
 let s=game();s=finish(s);s=finish(s);s=finish(s);assert.equal(s.phase,'sheriffJoin');
 const candidate=s.players.find(p=>p.alive)!.seat;s=finish(s,(_s,seat)=>({type:'sheriffJoin',value:seat===candidate}));
 s=finish(s);assert.equal(s.phase,'sheriffWithdraw');s=finish(s);assert.equal(s.sheriff,candidate);
});
test('self destruct is legal only on own discussion turn and jumps to next night',()=>{
 let s=day(game(8));const w=role(s,'wolf');assert.throws(()=>act(s,w,{type:'selfDestruct'}),/NOT_ELIGIBLE|INVALID_PAYLOAD/);
 while(s.window.actors[0]!==w)s=act(s,s.window.actors[0],{type:'speak',text:'继续讨论'});
 s=act(s,w,{type:'selfDestruct'});assert.equal(s.players[w-1].alive,false);assert.equal(s.players[w-1].revealedRole,'wolf');assert.equal(s.day,2);
});
test('duplicate commands return the accepted result and stale commands are rejected',()=>{
 let s=game();const w=role(s,'wolf');const command={commandId:'same',windowId:observe(s,w).windowId!,action:{type:'wolfVote' as const,targetSeat:2}};
 s=submit(s,w,command);assert.equal(submit(s,w,command).version,s.version);
 assert.throws(()=>submit(s,w,{...command,action:{type:'wolfVote',targetSeat:3}}),/DUPLICATE_CONFLICT/);
 assert.throws(()=>submit(s,w,{...command,commandId:'new',windowId:'wrong'}),/WINDOW_CLOSED/);
});

test('scripted default games terminate exactly at day30 with intact alive participants',()=>{
 for(let n=6;n<=14;n++){let s=game(n);let steps=0;while(!s.outcome){assert.ok(++steps<2000);const seat=s.window.actors.find(i=>!Object.hasOwn(s.window.answers,i));assert.ok(seat);s=act(s,seat!,defaultAction(observe(s,seat!)));}assert.equal(s.outcome.status,'draw');assert.equal(s.day,30);assert.equal(s.players.filter(p=>p.alive).length,n);}
});
test('hidden role swap cannot alter a villager view',()=>{const s=game();const v=role(s,'villager');const before=observe(s,v);const seer=role(s,'seer'),witch=role(s,'witch');[s.players[seer-1].role,s.players[witch-1].role]=[s.players[witch-1].role,s.players[seer-1].role];assert.deepEqual(observe(s,v),before);});
