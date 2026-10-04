export interface PresentationCompletion {eventId:string;status:'finished'|'skipped'|'cancelled'}
export interface SpeechOutput {synthesize(input:{text:string;voiceProfile:Record<string,string|number>;signal:AbortSignal}):Promise<{audioRef:string;segments:{startMs:number;endMs:number;text:string}[]}>;play(audioRef:string):Promise<void>;pause():void;resume():void;stop():void}
export interface SpeechInput {start(input:{language:string;signal:AbortSignal}):Promise<string>}
