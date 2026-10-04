import type {Action,Observation} from '../domain/types.js';
import type {Persona} from './personas.js';
import {defaultAction} from '../domain/engine.js';
import {digest} from '../domain/random.js';
// Offline demo uses exactly the same projected input and validation as the LLM.
export function demoDecision(o:Observation,p:Persona):Action{const r=o.legalActions[0];if(!r)return defaultAction(o);const pick=(targets:number[])=>targets.length?targets[parseInt(digest(`${o.windowId}:${o.ownSeat}`).slice(0,8),16)%targets.length]:null;
 switch(r.type){case 'wolfVote':return{type:r.type,targetSeat:pick((r.targets||[]).filter(i=>!o.ownFacts.wolves?.includes(i)))};
 case 'seerCheck':return{type:r.type,targetSeat:pick((r.targets||[]).filter(i=>!o.ownFacts.checks?.some(c=>c.seat===i)))};
 case 'witchUse':if(r.modes?.includes('save'))return{type:r.type,mode:'save',targetSeat:o.ownFacts.knife};return defaultAction(o);
 case 'exileVote':case 'sheriffVote':{let targets=r.targets||[];if(o.ownRole==='wolf')targets=targets.filter(i=>!o.ownFacts.wolves?.includes(i));const checked=o.ownFacts.checks?.find(c=>c.faction==='wolf'&&targets.includes(c.seat));return{type:r.type,targetSeat:checked?.seat??pick(targets)};}
 case 'sheriffJoin':return{type:r.type,value:p.traits.expression>55};case 'hunterShoot':return{type:r.type,targetSeat:pick(r.targets||[])};
 case 'speak':{const known=o.ownFacts.checks?.at(-1);const suspect=pick(o.players.filter(q=>q.alive&&q.seat!==o.ownSeat&&!o.ownFacts.wolves?.includes(q.seat)).map(q=>q.seat));const text=known?`我报一下自己的信息：${known.seat}号是${known.faction==='wolf'?'狼人':'好人'}。请大家对照前面的发言和票型来判断，不要只看谁的声音大。`:`${p.catchphrases[0]||'先把发言听完整。'} 我目前更关注${suspect||'还活着的其他'}号的逻辑是否前后一致，但这只是怀疑，并没有身份事实。希望后面的朋友能解释一下自己的投票依据。`;return{type:r.type,text:[...text].slice(0,r.maxLength).join(''),gestureId:p.traits.performance>50?'thoughtful':'calm'};}
 default:return defaultAction(o);}
}
