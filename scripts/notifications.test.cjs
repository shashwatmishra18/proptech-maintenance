const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function load(file, overrides = {}, cache = new Map()) {
  file=path.resolve(file); if(cache.has(file))return cache.get(file).exports; const mod={exports:{}};cache.set(file,mod);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const local=name=>Object.hasOwn(overrides,name)?overrides[name]:name.startsWith('@/')?load('src/'+name.slice(2)+'.ts',overrides,cache):name.startsWith('.')?load(path.resolve(path.dirname(file),name)+'.ts',overrides,cache):require(name);
  new Function('require','module','exports',code)(local,mod,mod.exports);return mod.exports;
}
test('notification filters and read inputs reject identity injection, repeats handled at route, unbounded pagination and unsafe cutoffs',()=>{
  const {notificationQuery,notificationRead}=load('src/lib/notification-query.ts');
  for(const input of [{userId:'other'},{page:'0'},{page:'1.5'},{pageSize:'51'},{state:'invalid'}])assert.throws(()=>notificationQuery.parse(input));
  assert.equal(notificationQuery.parse({}).pageSize,10);
  for(const input of [{all:true},{all:true,before:'bad'},{ids:[],userId:'other'}])assert.throws(()=>notificationRead.parse(input));
});
test('notification links use current ticket authorization and never message parsing or legacy guesses',()=>{
  const {notificationTicketHref}=load('src/lib/notification-query.ts'); const ticket={id:'ticket',tenantId:'tenant',assignedToId:'tech',property:{managerId:'manager'}};
  for(const [role,userId,prefix]of[['TENANT','tenant','/tickets/'],['MANAGER','manager','/manager/tickets/'],['TECHNICIAN','tech','/tech/tickets/']])assert.equal(notificationTicketHref(ticket,{role,userId}),prefix+'ticket');
  for(const role of ['TENANT','MANAGER','TECHNICIAN'])assert.equal(notificationTicketHref(ticket,{role,userId:'foreign'}),null);
  assert.equal(notificationTicketHref(null,{role:'TENANT',userId:'tenant'}),null);
});
test('notification pagination/counts share authenticated scope and a repeatable-read snapshot',async()=>{
  const seen=[];let isolation;const db={notification:{count:async input=>{seen.push(input);return 3;},findMany:async input=>{seen.push(input);return[{id:'n',message:'Legacy',read:false,createdAt:new Date(),ticket:null}];}},$transaction:async(callback,options)=>{isolation=options.isolationLevel;return callback(db);}};
  const route=load('src/app/api/notifications/route.ts',{'@/lib/prisma':{prisma:db},'@/lib/roles':{requireAuth:async()=>({userId:'owner',role:'TENANT'})}});
  const result=await route.GET({nextUrl:new URL('http://localhost/api/notifications?page=2&pageSize=2')});const data=(await result.json()).data;
  assert.equal(isolation,'RepeatableRead');assert.equal(data.page,2);assert.equal(data.notifications[0].ticketHref,null);for(const item of seen)assert.equal(item.where.userId,'owner');assert.equal(seen[1].skip,2);assert.equal(seen[1].take,2);
  assert.equal((await route.GET({nextUrl:new URL('http://localhost/api/notifications?page=1&page=2')})).status,400);
});
test('mark-all read is owner-bound with an explicit cutoff, rejecting future timestamps',async()=>{
  let where;const tx={notification:{updateMany:async input=>{where=input.where;return{count:2};},count:async()=>1}};
  const route=load('src/app/api/notifications/route.ts',{'@/lib/prisma':{prisma:{$transaction:async cb=>cb(tx)}},'@/lib/roles':{requireAuth:async()=>({userId:'owner'})}});
  const before=new Date(Date.now()-1000).toISOString();assert.equal((await route.PATCH({json:async()=>({all:true,before})})).status,200);assert.equal(where.userId,'owner');assert.equal(where.createdAt.lte.toISOString(),before);assert.equal(where.read,false);
  assert.equal((await route.PATCH({json:async()=>({all:true,before:new Date(Date.now()+10000).toISOString()})})).status,400);
});
test('production credential delivery sends safe purpose URLs to an injectable provider and never returns bearer tokens',async()=>{
  const previous={...process.env};try{process.env.NODE_ENV='production';process.env.APP_ORIGIN='https://maintenance.example.test';const sent=[];const {deliverCredential}=load('src/lib/credential-delivery.ts');
    for(const purpose of ['INVITE','RESET']){const result=await deliverCredential({purpose,email:'qa@example.test',token:'a'.repeat(64)},{send:async message=>{sent.push(message);return'accepted';}});assert.deepEqual(result,{delivered:true,delivery:'accepted'});assert.equal('url'in result,false);}
    assert.match(sent[0].text,/https:\/\/maintenance.example.test\/accept-invitation#token=/);assert.match(sent[1].text,/\/reset-password#token=/);assert.equal(sent[0].to,'qa@example.test');assert.ok(!sent[0].idempotencyKey.includes('a'.repeat(64)));
    assert.deepEqual(await deliverCredential({purpose:'INVITE',email:'qa@example.test',token:'a'.repeat(64)},{send:async()=>{throw Error('Sensitive provider details');}}),{delivered:false,delivery:'failed'});
    process.env.APP_ORIGIN='http://unsafe.example';assert.equal((await deliverCredential({purpose:'RESET',email:'qa@example.test',token:'a'.repeat(64)},{send:()=>{throw Error('Must not send');}})).delivery,'unconfigured');
  }finally{process.env=previous;}
});
test('Resend adapter handles acceptance, provider failure, invalid responses and network errors without logging bodies',async()=>{
  const previous={...process.env},oldFetch=global.fetch;try{process.env.EMAIL_PROVIDER='resend';process.env.RESEND_API_KEY='test-key';process.env.EMAIL_FROM='qa@example.test';let status=200,throws=false,invalid=false,options;global.fetch=async(url,input)=>{assert.equal(url,'https://api.resend.com/emails');options=input;if(throws)throw Error('Bearer secret');return{ok:status===200,json:async()=>invalid?{}:{id:'provider-id'}};};
    const sender=load('src/lib/email-delivery.ts').resendSender;const message={to:'recipient@example.test',subject:'Safe subject',text:'Test link',idempotencyKey:'hash'};assert.equal(await sender.send(message),'accepted');assert.equal(options.headers['Idempotency-Key'],'hash');assert.deepEqual(JSON.parse(options.body).to,[message.to]);invalid=true;assert.equal(await sender.send(message),'failed');invalid=false;status=500;assert.equal(await sender.send(message),'failed');throws=true;assert.equal(await sender.send(message),'failed');delete process.env.RESEND_API_KEY;assert.equal(await sender.send(message),'unconfigured');
  }finally{process.env=previous;global.fetch=oldFetch;}
});
test('notification history retains legacy text, safe links, bounded pagination and loading/error/empty states',()=>{
  let resource={data:{notifications:[{id:'n',message:'Legacy notification',read:false,createdAt:new Date().toISOString(),ticketHref:null}],unreadCount:1,total:1,page:1,totalPages:1,snapshotAt:new Date().toISOString()},loading:false,error:null};
  const component=load('src/components/NotificationHistory.tsx',{react:{...require('react'),useState:value=>[value,()=>{}]},'next/link':{default:'a'},'@/hooks/use-resource':{useResource:()=>resource},'@/hooks/use-mutation':{useMutation:()=>({pending:false,run:()=>{}})},'@/hooks/use-toast':{useToast:()=>({toast(){}})},'./ui/button':{Button:'button'},'./RequestState':{LoadingState:'loading',ErrorState:'error'}}).NotificationHistory;
  const nodes=tree=>!tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];let tree=nodes(component());assert.ok(tree.some(n=>n.type==='ol'));assert.ok(tree.some(n=>n.props?.['aria-label']==='Notification pagination'));assert.ok(!tree.some(n=>n.type==='a'));
  resource={...resource,loading:true};assert.ok(nodes(component()).some(n=>n.type==='loading'));resource={...resource,loading:false,error:Error('Offline')};assert.ok(nodes(component()).some(n=>n.type==='error'));resource={...resource,error:null,data:{...resource.data,notifications:[]}};assert.ok(JSON.stringify(component()).includes('No notifications yet'));
});
