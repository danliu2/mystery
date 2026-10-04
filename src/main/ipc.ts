import Ajv from 'ajv';
const ajv=new Ajv({allErrors:false});
const string={type:'string',maxLength:200};const nullable={type:'null'};
const action={type:'object',required:['type'],additionalProperties:false,properties:{type:{type:'string',enum:['wolfVote','seerCheck','witchUse','speak','exileVote','sheriffJoin','sheriffWithdraw','sheriffVote','chooseDirection','badgeTransfer','hunterShoot','selfDestruct']},targetSeat:{type:['integer','null'],minimum:1,maximum:14},mode:{type:'string',enum:['none','save','poison']},value:{type:'boolean'},direction:{type:'string',enum:['clockwise','counterclockwise']},text:{type:'string',maxLength:1200},gestureId:{type:'string',enum:['neutral','thoughtful','smile','frown','calm']}}};
const schemas:Record<string,any>={
 bootstrap:nullable,lobby:nullable,view:nullable,pause:nullable,resume:nullable,abandon:nullable,review:nullable,rest:nullable,saves:nullable,settings:nullable,reloadProvider:nullable,testProvider:nullable,budget:nullable,manual:nullable,
 start:{type:'object',required:['count'],additionalProperties:false,properties:{count:{type:'integer',minimum:6,maximum:14},humanRole:{type:'string',enum:['wolf','villager','seer','witch','hunter','idiot']},humanName:{type:'string',maxLength:20},mode:{type:'string',enum:['model','demo']}}},
 act:{type:'object',required:['commandId','windowId','action'],additionalProperties:false,properties:{commandId:{type:'string',minLength:1,maxLength:100},windowId:{type:'string',minLength:1,maxLength:100},action}},
 ack:{type:'string',pattern:'^v[0-9]+$',maxLength:20},
 load:{type:'string',pattern:'^game-[0-9]+$',maxLength:40},deleteSave:{type:'string',pattern:'^game-[0-9]+$',maxLength:40},
 rosterReset:{type:'object',required:['useModel'],additionalProperties:false,properties:{useModel:{type:'boolean'}}},
 updateSettings:{type:'object',required:['baseURL','model','jsonMode','contextTokens'],additionalProperties:false,properties:{baseURL:string,model:string,jsonMode:{type:'boolean'},contextTokens:{type:'integer',minimum:2048,maximum:1000000}}}
};
const validators=Object.fromEntries(Object.entries(schemas).map(([k,v])=>[k,ajv.compile(v)]));
export const IPC_METHODS=Object.keys(validators);
export function validateIPC(method:string,payload:unknown){const check=validators[method];if(!check||!check(payload??null))throw new Error('INVALID_IPC');return payload;}
