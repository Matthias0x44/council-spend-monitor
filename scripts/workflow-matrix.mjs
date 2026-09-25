import fs from 'node:fs';
const all=JSON.parse(fs.readFileSync('data/england-registry.json','utf8')).authorities.map(a=>a.slug);
const requested=process.env.COUNCIL_SLUG||'';
if(requested&&!all.includes(requested))throw new Error('Council slug is not in the English authority register');
const selected=requested?[requested]:all;
const groups=[];
for(let i=0;i<selected.length;i+=15)groups.push({id:String(groups.length+1),slugs:selected.slice(i,i+15).join(',')});
const line=`matrix=${JSON.stringify({include:groups})}\n`;
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,line);else process.stdout.write(line);
