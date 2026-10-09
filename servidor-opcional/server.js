// Servidor de prueba para sincronización. NO apto para datos reales de nómina.
const http=require('node:http'),fs=require('node:fs'),crypto=require('node:crypto');
const PORT=Number(process.env.PORT||3000),KEY=process.env.TIMECORE_KEY;
if(!KEY||KEY.length<20){console.error('Configura TIMECORE_KEY con al menos 20 caracteres');process.exit(1)}
const DB=process.env.DATA_FILE||'./timecore-data.json';
let data={employees:[],attendance:[],admin:null,config:{salary:408,halfSalary:204,paidDays:30,normalHours:8,extraRate:3}};
try{data=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{}
const seen=new Set();
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-TimeCore-Key','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
http.createServer((req,res)=>{
 if(req.method==='OPTIONS')return send(res,204,{});
 if(req.url!=='/api/sync'||req.method!=='POST')return send(res,404,{error:'Not found'});
 const a=Buffer.from(req.headers['x-timecore-key']||''),b=Buffer.from(KEY);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return send(res,401,{error:'Unauthorized'});
 let raw='';req.on('data',c=>{raw+=c;if(raw.length>2e6)req.destroy()});req.on('end',()=>{try{const payload=JSON.parse(raw);for(const ch of (payload.changes||[]).slice(0,100)){
 if(!ch.id||seen.has(ch.id)||!ch.state)continue;seen.add(ch.id);const s=ch.state;
 // Mezcla básica por ID. No ofrece resolución segura de conflictos ni autorización por rol.
 for(const e of s.employees||[])if(!data.employees.some(x=>x.id===e.id))data.employees.push(e);
 for(const r of s.attendance||[]){const i=data.attendance.findIndex(x=>x.employeeId===r.employeeId&&x.date===r.date);if(i<0)data.attendance.push(r);else if(r.clock_out&&!data.attendance[i].clock_out)data.attendance[i].clock_out=r.clock_out}
 if(!data.admin&&s.admin)data.admin=s.admin;if(s.config)data.config=s.config;
 }fs.writeFileSync(DB,JSON.stringify(data));send(res,200,{state:data})}catch(e){send(res,400,{error:'Invalid request'})}})
}).listen(PORT,()=>console.log('TimeCore test server on port '+PORT));
