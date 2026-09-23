import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash} from 'bcryptjs';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient(),base=process.env.TEST_API_URL||'http://127.0.0.1:4000/api/v1';
const suffix=randomUUID().slice(0,8);
let organizationId='',storeId='',otherStoreId='',token='',receptionToken='';
async function request(path:string,body?:unknown,key=randomUUID(),auth=token,store=storeId){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth,'X-Store-Id':store,'Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
function ok(response:{status:number;data:any}){assert.ok(response.status<300,JSON.stringify(response));return response.data;}
async function main(){
 const org=await db.organization.create({data:{name:'Integration '+suffix}});organizationId=org.id;
 const store=await db.store.create({data:{organizationId,name:'Test studio',opensAt:'00:00',closesAt:'23:59',timezone:'UTC'}});storeId=store.id;
 const other=await db.store.create({data:{organizationId,name:'Isolated test store'}});otherStoreId=other.id;
 const password=randomUUID()+randomUUID();
 const admin=await db.user.create({data:{organizationId,username:'test-admin-'+suffix,name:'Test Admin',passwordHash:await hash(password,4),role:'ADMIN',storeIds:[storeId,otherStoreId]}});
 await db.user.create({data:{organizationId,username:'test-reception-'+suffix,name:'Test Reception',passwordHash:await hash(password,4),role:'RECEPTION',storeIds:[storeId]}});
 token=ok(await request('/auth/login',{username:admin.username,password})).token;
 receptionToken=ok(await request('/auth/login',{username:'test-reception-'+suffix,password})).token;
 const customer=ok(await request('/customers',{name:'Test Guest',mobile:'+919'+String(Date.now()).slice(-9)}));
 const service=ok(await request('/services',{name:'Test massage',price:'100.00',taxRate:'18',duration:60}));
 const product=ok(await request('/products',{name:'Test oil',sku:'TEST-'+suffix,price:'100.00',taxRate:'18'}));
 assert.equal((await request('/services',{name:'No access',price:'1',taxRate:'0'},randomUUID(),receptionToken)).status,403);
 assert.equal((await request('/customers',undefined,randomUUID(),receptionToken,otherStoreId)).status,403);
 const date=new Date();date.setUTCDate(date.getUTCDate()+2);date.setUTCHours(10,0,0,0);
 const booking={customerId:customer.id,serviceId:service.id,providerId:admin.id,startsAt:date.toISOString()};
 const bookings=await Promise.all([request('/appointments',booking),request('/appointments',booking)]);
 assert.equal(bookings.filter(r=>r.status<300).length,1);
 assert.equal(bookings.filter(r=>r.status===409).length,1);
 console.log('PASS concurrent appointments: exactly one booking');
 const appt=bookings.find(r=>r.status<300)!.data;
 assert.equal((await request('/appointments/'+appt.id+'/transition',{status:'COMPLETED',version:appt.version})).status,409);
 const checked=ok(await request('/appointments/'+appt.id+'/transition',{status:'CHECKED_IN',version:appt.version}));
 assert.equal((await request('/appointments/'+appt.id+'/transition',{status:'IN_PROGRESS',version:appt.version})).status,409);
 const started=ok(await request('/appointments/'+appt.id+'/transition',{status:'IN_PROGRESS',version:checked.version}));
 ok(await request('/appointments/'+appt.id+'/transition',{status:'COMPLETED',version:started.version}));
 console.log('PASS appointment workflow and stale version rejection');
 const receiptKey=randomUUID(),receipt={productId:product.id,quantity:1,reason:'Integration opening stock'};
 const first=ok(await request('/stock/receive',receipt,receiptKey)),again=ok(await request('/stock/receive',receipt,receiptKey));
 assert.equal(first.id,again.id);
 assert.equal((await request('/stock/receive',{...receipt,quantity:2},receiptKey)).status,409);
 assert.equal((await request('/stock/receive',receipt,receiptKey,token,otherStoreId)).status,409);
 const sale={customerId:customer.id,items:[{catalogItemId:product.id,quantity:1}]};
 const sales=await Promise.all([request('/invoices',sale),request('/invoices',sale)]);
 assert.equal(sales.filter(r=>r.status<300).length,1);assert.equal(sales.filter(r=>r.status===409).length,1);
 const invoice=sales.find(r=>r.status<300)!.data;
 assert.equal(invoice.grandTotal,'118');
 assert.equal((await db.stockBalance.findUniqueOrThrow({where:{storeId_productId:{storeId,productId:product.id}}})).onHand,0);
 assert.equal(await db.invoice.count({where:{organizationId}}),1);
 console.log('PASS last-stock race: losing invoice rolled back');
 const payKey=randomUUID(),payment={invoiceId:invoice.id,method:'UPI',amount:'60',reference:'UPI-'+suffix};
 const paid=ok(await request('/payments',payment,payKey)),retry=ok(await request('/payments',payment,payKey));
 assert.equal(paid.id,retry.id);assert.equal(paid.status,'PENDING_VERIFICATION');
 assert.equal((await db.invoice.findUniqueOrThrow({where:{id:invoice.id}})).paidTotal.toString(),'0');
 assert.equal((await request('/payments',{invoiceId:invoice.id,method:'CASH',amount:'60'})).status,409);
 assert.equal((await request('/payments/'+paid.id+'/verify',{decision:'VERIFY',version:paid.version},randomUUID(),receptionToken)).status,403);
 const verified=ok(await request('/payments/'+paid.id+'/verify',{decision:'VERIFY',version:paid.version}));
 assert.ok(verified.receiptNumber);
 assert.equal((await request('/payments/'+paid.id+'/verify',{decision:'VERIFY',version:paid.version})).status,409);
 const cashKey=randomUUID();const cash=ok(await request('/payments',{invoiceId:invoice.id,method:'CASH',amount:'58'},cashKey));
 assert.equal(ok(await request('/payments',{invoiceId:invoice.id,method:'CASH',amount:'58'},cashKey)).id,cash.id);
 const finalInvoice=await db.invoice.findUniqueOrThrow({where:{id:invoice.id}});
 assert.equal(finalInvoice.paidTotal.toString(),'118');assert.equal(finalInvoice.dueTotal.toString(),'0');
 console.log('PASS split cash/UPI, idempotency, verification, and overpayment protection');
 const otherInvoice=await request('/invoices/'+invoice.id,undefined,randomUUID(),token,otherStoreId);
 assert.equal(otherInvoice.status,404);
 assert.equal((await request('/invoices',{...sale,discountPercent:'11'},randomUUID(),receptionToken)).status,400);
 assert.equal((await request('/invoices',{...sale,grandTotal:'0'})).status,400);
 const dashboard=ok(await request('/reports/dashboard'));assert.equal(dashboard.collected,'118');assert.equal(dashboard.outstanding,'0');
 assert.ok(await db.auditEvent.count({where:{organizationId}})>0);
 assert.ok(await db.outboxEvent.count({where:{organizationId}})>0);
 ok(await request('/auth/logout',{}));
 assert.equal((await request('/stores')).status,401);
 console.log('PASS store isolation, discount limits, reconciled dashboard, audit/outbox, and session revocation');
}
async function cleanup(){
 if(!organizationId)return;
 await db.$transaction(async tx=>{
 for(const model of ['command','auditEvent','statusHistory','outboxEvent','payment','invoiceItem','invoice','stockLedger','stockBalance','appointment','catalogItem','customer','sequence','user','store'] as const) await (tx[model] as any).deleteMany({where:{organizationId}});
 await tx.organization.delete({where:{id:organizationId}});
 });
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await cleanup();await db.$disconnect();});
