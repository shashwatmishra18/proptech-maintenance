const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert/strict');
const req = require('module').createRequire(path.join(process.cwd(), 'package.json'));
req('@next/env').loadEnvConfig(process.cwd());
if (process.env.RUN_LIVE_INTEGRATION !== '1' || !process.env.INTEGRATION_DATABASE_URL) throw Error('Set RUN_LIVE_INTEGRATION=1 and INTEGRATION_DATABASE_URL for the isolated local test database');
const url = new URL(process.env.INTEGRATION_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.pathname, '/proptech_db');
assert.equal(url.port, '55432', 'Use only the isolated local integration database on port 55432');
url.hostname = '127.0.0.1';
process.env.DATABASE_URL = url.toString();
const { PrismaClient } = req('@prisma/client');
const db = new PrismaClient();
const ts = req('typescript');
const runId = Date.now();
const password = require('crypto').randomBytes(24).toString('hex');
let server;
const base = 'http://127.0.0.1:3103';
function load(file, overrides, cache = new Map()) {
  file = path.resolve(file); if(cache.has(file)) return cache.get(file).exports;
  const mod={exports:{}}; cache.set(file,mod);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const local=name=>Object.hasOwn(overrides,name)?overrides[name]:name.startsWith('@/')?load('src/'+name.slice(2)+'.ts',overrides,cache):name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts',overrides,cache):req(name);
  new Function('require','module','exports',code)(local,mod,mod.exports); return mod.exports;
}
async function api(route, cookie='', method='GET', data, expected=200) {
  const form=data instanceof FormData;
  const res=await fetch(base+route,{method,headers:{...(cookie?{cookie}:{}),...(data&&!form?{'Content-Type':'application/json'}:{})},body:data?(form?data:JSON.stringify(data)):undefined,redirect:'manual'});
  const body=await res.json(); assert.equal(res.status,expected,route+': '+JSON.stringify(body)); return {body:body.data,res};
}
async function login(email) { const {res}=await api('/api/auth/login','','POST',{email,password}); const cookie=res.headers.get('set-cookie'); assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=lax/i);assert.match(cookie,/Secure/i);return cookie.split(';')[0]; }
function form() { const f=new FormData(); f.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');return f; }
async function main() {
  for(const args of [['migrate','deploy'],['migrate','status']]) {
    const result=cp.spawnSync(process.execPath,['node_modules/prisma/build/index.js',...args],{env:process.env,stdio:'inherit'});assert.equal(result.status,0);
  }
  const connection=await db.$queryRaw`SELECT current_database() AS database, inet_server_addr()::text AS address, version() AS version`;
  assert.equal(connection[0].database,'proptech_db'); console.log('PASS: live PostgreSQL connection and migration status');
  server=cp.spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3103','-H','127.0.0.1'],{env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  let serverError='';server.stderr.on('data',b=>{serverError+=b.toString()});server.stdout.on('data',()=>{});
  let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(base+'/login');if(r.status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'Server startup failed');
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/tickets',{headers:{'x-middleware-subrequest':'middleware:middleware:middleware:middleware:middleware'}})).status,401);
  const email=role=>`integration.${runId}.${role}@example.test`;
  const tenant=(await api('/api/auth/register','','POST',{name:'Integration Tenant',email:email('tenant'),password},201)).body;
  await api('/api/auth/register','','POST',{name:'Integration Other',email:email('other'),password},201);
  await api('/api/auth/register','','POST',{name:'Escalation',email:email('attack'),password,role:'MANAGER'},400);
  await api('/api/auth/register','','POST',{name:'Integration Tenant',email:email('tenant'),password},400);
  const bcrypt=req('bcrypt');const hash=await bcrypt.hash(password,10);
  const manager=await db.user.create({data:{name:'Integration Manager',email:email('manager'),password:hash,role:'MANAGER'}});
  const tech=await db.user.create({data:{name:'Integration Tech',email:email('tech'),password:hash,role:'TECHNICIAN'}});
  const tech2=await db.user.create({data:{name:'Integration Tech Two',email:email('tech2'),password:hash,role:'TECHNICIAN'}});
  const tenantCookie=await login(email('tenant')),otherCookie=await login(email('other')),managerCookie=await login(email('manager')),techCookie=await login(email('tech')),tech2Cookie=await login(email('tech2'));
  await api('/api/tickets','','GET',undefined,401);await api('/api/tickets','session=invalid','GET',undefined,401);
  await api('/api/auth/login','','POST',{email:email('tenant'),password:'wrong-password'},400);
  await api('/api/auth/register','','POST',{name:'Escalation',email:email('attack-tech'),password,role:'TECHNICIAN'},400);
  await api('/api/users?role=TECHNICIAN',tenantCookie,'GET',undefined,403);await api('/api/users?role=TECHNICIAN',techCookie,'GET',undefined,403);
  const directory=(await api('/api/users?role=TECHNICIAN',managerCookie)).body;assert.ok(directory.some(user=>user.id===tech.id));assert.ok(directory.every(user=>Object.keys(user).sort().join(',')==='id,name'));
  const concurrentEmail=email('concurrent');const concurrent=await Promise.all([1,2].map(()=>fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Concurrent tenant',email:concurrentEmail,password})})));assert.deepEqual(concurrent.map(res=>res.status).sort(),[201,400].sort());
  console.log('PASS: tenant registration (including concurrent email), role restrictions, directory, login and sessions');
  const upload=(await api('/api/upload',tenantCookie,'POST',form())).body.imageUrls;
  await api('/api/tickets',otherCookie,'POST',{title:'Unauthorized attachment',description:'A sufficiently long description',imageUrls:upload},400);
  const title='Kitchen <tap> & sink';const description='Water leaking & needs <repair> today';
  const ticket=(await api('/api/tickets',tenantCookie,'POST',{title,description,priority:'HIGH',imageUrls:upload},201)).body;
  const read=await db.ticket.findUnique({where:{id:ticket.id}});assert.equal(read.priority,'HIGH');assert.equal(read.title,title);assert.equal(read.description,description);assert.equal(read.status,'OPEN');
  for(const priority of ['LOW','MEDIUM','URGENT']) {const t=(await api('/api/tickets',tenantCookie,'POST',{title:'Priority check '+priority,description:'Priority persistence integration',priority},201)).body;assert.equal((await db.ticket.findUnique({where:{id:t.id}})).priority,priority);}
  const defaultTicket=(await api('/api/tickets',tenantCookie,'POST',{title:'Default priority check',description:'Default priority integration test'},201)).body;assert.equal(defaultTicket.priority,'MEDIUM');
  await api('/api/tickets',tenantCookie,'POST',{title,description,priority:'INVALID'},400);
  await api('/api/tickets',tenantCookie,'POST',{title,description,imageUrls:['https://example.test/image.png']},400);
  await api('/api/tickets?status=INVALID',tenantCookie,'GET',undefined,400);await api('/api/users?role=INVALID',managerCookie,'GET',undefined,400);
  console.log('PASS: creation, all schema priorities including URGENT, default, raw text and filter validation');
  const detail=(await api('/api/tickets/'+ticket.id,tenantCookie)).body;const imageUrl=detail.images[0].imageUrl;
  assert.equal((await fetch(base+imageUrl)).status,401);assert.equal((await fetch(base+imageUrl,{headers:{cookie:otherCookie}})).status,404);assert.equal((await fetch(base+imageUrl,{headers:{cookie:techCookie}})).status,404);
  for(const cookie of [tenantCookie,managerCookie]) {const r=await fetch(base+imageUrl,{headers:{cookie}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');assert.match(r.headers.get('cache-control'),/private/);}
  await api('/api/upload',tenantCookie,'DELETE',{imageUrls:upload});assert.equal((await fetch(base+imageUrl,{headers:{cookie:tenantCookie}})).status,200);
  await api('/api/tickets',tenantCookie,'POST',{title,description,imageUrls:upload},409);
  console.log('PASS: private attachments, owner/role authorization and linked-file cleanup protection');
  await api('/api/tickets/'+ticket.id,otherCookie,'GET',undefined,403);
  await api('/api/tickets/'+ticket.id+'/notes',otherCookie,'POST',{note:'Unauthorized note'},403);
  await api('/api/tickets/'+ticket.id+'/notes',tenantCookie,'POST',{note:'Tenant integration note'},201);
  await api('/api/tickets/'+ticket.id+'/notes',managerCookie,'POST',{note:'Manager integration note'},201);
  const statusRoute='/api/tickets/'+ticket.id+'/status';
  await api(statusRoute,tenantCookie,'POST',{technicianId:tech.id},403);
  await api(statusRoute,managerCookie,'POST',{technicianId:tech.id});assert.equal((await db.ticket.findUnique({where:{id:ticket.id}})).status,'ASSIGNED');
  assert.equal((await fetch(base+imageUrl,{headers:{cookie:techCookie}})).status,200);
  await api(statusRoute,managerCookie,'POST',{technicianId:tech2.id},409);await api(statusRoute,tech2Cookie,'PATCH',{status:'IN_PROGRESS'},403);await api(statusRoute,techCookie,'PATCH',{status:'DONE'},400);
  await api('/api/tickets/'+ticket.id+'/notes',techCookie,'POST',{note:'Checked <valve> & fitting'},201);
  assert.ok(await db.activityLog.findFirst({where:{ticketId:ticket.id,action:'Note added: Checked <valve> & fitting'}}));
  await api(statusRoute,techCookie,'PATCH',{status:'IN_PROGRESS'});await api(statusRoute,techCookie,'PATCH',{status:'IN_PROGRESS'},409);await api(statusRoute,techCookie,'PATCH',{status:'DONE'});await api(statusRoute,techCookie,'PATCH',{status:'DONE'},409);
  await api('/api/tickets/'+ticket.id+'/notes',techCookie,'POST',{note:'Late note'},400);assert.equal((await db.ticket.findUnique({where:{id:ticket.id}})).status,'DONE');
  console.log('PASS: manager assignment, technician lifecycle, notes, ownership and stale conflicts');
  await db.notification.createMany({data:Array.from({length:12},(_,i)=>({userId:tenant.id,message:'Integration unread '+i}))});
  const notifications=(await api('/api/notifications',tenantCookie)).body;assert.equal(notifications.notifications.length,10);assert.ok(notifications.unreadCount>10);
  const ids=notifications.notifications.map(n=>n.id);const result=(await api('/api/notifications',tenantCookie,'PATCH',{ids})).body;assert.equal(result.unreadCount,notifications.unreadCount-10);assert.equal(await db.notification.count({where:{userId:tenant.id,read:false}}),result.unreadCount);
  const foreign=await db.notification.findFirst({where:{userId:manager.id,read:false}});assert.ok(foreign);await api('/api/notifications',tenantCookie,'PATCH',{ids:[foreign.id]});assert.equal((await db.notification.findUnique({where:{id:foreign.id}})).read,false);
  assert.equal(await db.notification.count({where:{userId:tech.id}}),1);
  const tenantList=(await api('/api/tickets',tenantCookie)).body;assert.ok(tenantList.every(t=>t.tenant.id===tenant.id));
  const techList=(await api('/api/tickets',techCookie)).body;assert.ok(techList.every(t=>t.assignedTo?.id===tech.id));
  assert.ok((await api('/api/tickets',managerCookie)).body.some(t=>t.id===ticket.id));
  console.log('PASS: transactional workflow notifications and targeted read ownership/unseen retention');
  const racing=(await api('/api/tickets',tenantCookie,'POST',{title:'Concurrent assignment check',description:'Real concurrent requests integration'},201)).body;
  async function race(route,cookie,method,bodies){const results=await Promise.all(bodies.map(body=>fetch(base+route,{method,headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body)})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);}
  await race('/api/tickets/'+racing.id+'/status',managerCookie,'POST',[{technicianId:tech.id},{technicianId:tech2.id}]);
  const winner=await db.ticket.findUnique({where:{id:racing.id}});const winnerCookie=winner.assignedToId===tech.id?techCookie:tech2Cookie;
  await race('/api/tickets/'+racing.id+'/status',winnerCookie,'PATCH',[{status:'IN_PROGRESS'},{status:'IN_PROGRESS'}]);
  await race('/api/tickets/'+racing.id+'/status',winnerCookie,'PATCH',[{status:'DONE'},{status:'DONE'}]);
  assert.equal(await db.activityLog.count({where:{ticketId:racing.id}}),4);
  console.log('PASS: concurrent assignment/start/completion: one winner, one 409, no duplicate logs');
  const failNotifications={create:async(userId,message,tx)=>{await tx.notification.create({data:{userId,message}});throw new Error('Integration notification fault');},createForAdmins:async(message,tx)=>{await tx.notification.create({data:{userId:manager.id,message}});throw new Error('Integration notification fault');}};
  const service=load('src/lib/services/TicketService.ts',{'../prisma':{prisma:db},'./prisma':{prisma:db},'./NotificationService':{NotificationService:failNotifications}}).TicketService;
  const counts=async()=>Promise.all([db.ticket.count(),db.activityLog.count(),db.notification.count()]);
  const beforeCreate=await counts();await assert.rejects(service.create({title:'Rollback creation',description:'Real PostgreSQL rollback verification',priority:'HIGH',tenantId:tenant.id},[]),/Integration notification fault/);assert.deepEqual(await counts(),beforeCreate);
  const beforeAssign=await counts();await assert.rejects(service.assign(defaultTicket.id,tech.id,manager.id),/Integration notification fault/);assert.deepEqual(await counts(),beforeAssign);assert.equal((await db.ticket.findUnique({where:{id:defaultTicket.id}})).status,'OPEN');
  await api('/api/tickets/'+defaultTicket.id+'/status',managerCookie,'POST',{technicianId:tech.id});await api('/api/tickets/'+defaultTicket.id+'/status',techCookie,'PATCH',{status:'IN_PROGRESS'});
  const beforeDone=await counts();await assert.rejects(service.updateStatus(defaultTicket.id,'DONE',tech.id),/Integration notification fault/);assert.deepEqual(await counts(),beforeDone);assert.equal((await db.ticket.findUnique({where:{id:defaultTicket.id}})).status,'IN_PROGRESS');
  console.log('PASS: real PostgreSQL rollback of ticket/log/notification writes on injected notification failure');
  const failedUpload=(await api('/api/upload',tenantCookie,'POST',form())).body.imageUrls;
  const uploadPath=path.join(process.cwd(),'storage/uploads',failedUpload[0].split('/').pop());assert.ok(fs.existsSync(uploadPath));
  const beforeUploadFailure=await counts();await assert.rejects(service.create({title:'Rollback uploaded ticket',description:'Notification failure cleans own unlinked upload',priority:'LOW',tenantId:tenant.id},failedUpload),/Integration notification fault/);assert.deepEqual(await counts(),beforeUploadFailure);assert.equal(fs.existsSync(uploadPath),false);
  const abandoned=(await api('/api/upload',tenantCookie,'POST',form())).body.imageUrls;
  await api('/api/upload',otherCookie,'DELETE',{imageUrls:abandoned},400);await api('/api/upload',tenantCookie,'DELETE',{imageUrls:abandoned});assert.equal(fs.existsSync(path.join(process.cwd(),'storage/uploads',abandoned[0].split('/').pop())),false);
  assert.equal((await fetch(base+upload[0],{headers:{cookie:tenantCookie}})).status,404);
  console.log('PASS: failed creation cleans only owned unlinked uploads; arbitrary external/private references denied');
  const logout=(await api('/api/auth/logout',tenantCookie,'POST')).res.headers.get('set-cookie');assert.match(logout,/Max-Age=0/i);assert.match(logout,/HttpOnly/i);await api('/api/tickets','','GET',undefined,401);
  console.log('PASS: logout session-cookie expiry');
  console.log('ALL LIVE INTEGRATION CHECKS PASSED. Fixtures retained in isolated local development database.');
}
main().catch(e=>{console.error('LIVE INTEGRATION FAILED:',e.message);process.exitCode=1}).finally(async()=>{if(server)server.kill();await db.$disconnect()});
