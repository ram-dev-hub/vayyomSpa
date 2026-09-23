import {config} from 'dotenv';
import {resolve} from 'node:path';
config({path:resolve(__dirname,'../../../.env')});
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
let stopped=false;
process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
async function run() {
 console.log('Vayyom outbox worker started');
 while(!stopped) {
  const job=await db.$transaction(async tx=>{
   const now=new Date();
   const item=await tx.outboxEvent.findFirst({where:{OR:[{status:'PENDING',availableAt:{lte:now}},{status:'PROCESSING',lockedUntil:{lt:now}}]},orderBy:{createdAt:'asc'}});
   if(!item)return null;
   const claimed=await tx.outboxEvent.updateMany({where:{id:item.id,status:item.status,attempts:item.attempts},data:{status:'PROCESSING',lockedUntil:new Date(Date.now()+60000),attempts:{increment:1}}});
   return claimed.count?item:null;
  });
  if(!job){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
  try {
   if(!process.env.NOTIFICATION_WEBHOOK_URL) {
    await db.outboxEvent.update({where:{id:job.id},data:{status:'AWAITING_PROVIDER',lastError:'Configure notification webhook, then requeue these events',lockedUntil:null}});
    continue;
   }
   const response=await fetch(process.env.NOTIFICATION_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(process.env.NOTIFICATION_WEBHOOK_TOKEN||''),'Idempotency-Key':job.id,'X-Correlation-Id':job.traceId},body:JSON.stringify({id:job.id,type:job.type,entityId:job.entityId,organizationId:job.organizationId,storeId:job.storeId}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Provider HTTP '+response.status);
   await db.outboxEvent.update({where:{id:job.id},data:{status:'DELIVERED',lockedUntil:null,lastError:null}});
  } catch {
   const attempts=job.attempts+1;
   await db.outboxEvent.update({where:{id:job.id},data:{status:attempts>=5?'DEAD_LETTER':'PENDING',availableAt:new Date(Date.now()+Math.min(3600000,2**attempts*10000)),lockedUntil:null,lastError:'Provider delivery failed; inspect provider logs using event ID'}});
  }
 }
}
run().catch(()=>{console.error('Worker stopped unexpectedly');process.exitCode=1;}).finally(()=>db.$disconnect());
