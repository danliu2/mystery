import {createHash} from 'node:crypto';
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function random(rng:Record<string,number>,key:string){let x=rng[key]||0x9e3779b9;x^=x<<13;x^=x>>>17;x^=x<<5;rng[key]=x>>>0;return (x>>>0)/4294967296;}
export function shuffle<T>(values:T[],rng:Record<string,number>,key:string){const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(random(rng,key)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
