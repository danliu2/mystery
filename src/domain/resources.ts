import presets from '../../resources/games/werewolf/presets.json';
import roles from '../../resources/games/werewolf/roles.json';
import type {Preset,Role} from './types.js';
export const PRESETS=presets as Preset[];
export const ROLES=roles;
export function validatePresets(items:Preset[]=PRESETS){
 for(const p of items){
  if(!Number.isInteger(p.count)||p.count<6||p.count>14||!['city','edge'].includes(p.winMode)||p.version!==1||p.maxDays!==30||typeof p.sheriff!=='boolean')throw new Error('INVALID_PRESET');
  if(Object.keys(p.roles).sort().join()!==Object.keys(ROLES).sort().join())throw new Error('INVALID_ROLES');
  const values=Object.entries(p.roles);if(values.some(([r,v])=>!Number.isInteger(v)||v<0||(r!=='wolf'&&r!=='villager'&&v>1))||values.reduce((n,[,v])=>n+v,0)!==p.count||p.roles.wolf<1||p.roles.villager<1||values.filter(([r])=>r!=='wolf'&&r!=='villager').reduce((n,[,v])=>n+v,0)<1)throw new Error('INVALID_ROLE_COUNTS');
 }
}
export function roleName(role:Role){return ROLES[role].name;}
