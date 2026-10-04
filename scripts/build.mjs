import {build} from 'esbuild';import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/main/index.ts'],outfile:'dist/main.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron'],sourcemap:true});
await build({entryPoints:['src/renderer/App.tsx'],outfile:'dist/app.js',bundle:true,platform:'browser',target:'chrome120',format:'iife',define:{'process.env.NODE_ENV':'"production"'},sourcemap:true});
for(const [source,target] of [['src/preload/index.cjs','dist/preload.cjs'],['src/renderer/index.html','dist/index.html'],['src/renderer/style.css','dist/style.css'],['doc/06_player_guide.md','dist/player-guide.md']])await copyFile(source,target);
