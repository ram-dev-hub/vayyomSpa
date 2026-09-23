import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {calculateLine,minor,major} from '@vayyom/shared';
import {db} from './db';
import {AuthedRequest,allow,deskRoles,managerRoles} from './auth';
import {bookingInput,invoiceInput,paymentInput,stockInput,transitions,storeTime,uuid} from './validation';
import {z} from 'zod';
type Tx=Prisma.TransactionClient;
export const scope=(r:AuthedRequest)=>({organizationId:r.actor.organizationId,storeId:r.storeId});
export async function audit(tx:Tx,r:AuthedRequest,entityId:string,action:string) {
 await tx.auditEvent.create({data:{...scope(r),actorId:r.actor.id,entityId,action,traceId:r.traceId}});
}
async function event(tx:Tx,r:AuthedRequest,entityId:string,type:string) {
 await audit(tx,r,entityId,type);
 await tx.outboxEvent.create({data:{...scope(r),entityId,type,traceId:r.traceId}});
}
export async function command(r:AuthedRequest,action:string,input:unknown,run:(tx:Tx)=>Promise<unknown>) {
 const key=z.string().min(8).max(100).regex(/^[\w-]+$/).parse(r.headers['idempotency-key']);
 const fingerprint=createHash('sha256').update(JSON.stringify({action,input,store:r.storeId,actor:r.actor.id})).digest('hex');
 for(let attempt=0;attempt<3;attempt++) {
 try {
  return await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM Store WHERE id = ${r.storeId} FOR UPDATE`;
   const previous=await tx.command.findUnique({where:{organizationId_key:{organizationId:r.actor.organizationId,key}}});
   if(previous) {
    if(previous.fingerprint!==fingerprint) throw new ConflictException('Idempotency key was already used for a different request or store');
    return previous.result;
   }
   const result=await run(tx);
   const json=JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
   await tx.command.create({data:{...scope(r),actorId:r.actor.id,key,fingerprint,result:json}});
   return json;
  },{isolationLevel:'Serializable',maxWait:10000,timeout:15000});
 }catch(e) {
  if(e instanceof Prisma.PrismaClientKnownRequestError && ['P2034','P2002'].includes(e.code) && attempt<2) continue;
  throw e;
 }
 }
 throw new ConflictException('Concurrent update; retry with the same idempotency key');
}
async function number(tx:Tx,r:AuthedRequest,prefix:string) {
 const id=r.storeId+':'+prefix;
 const seq=await tx.sequence.upsert({where:{id},create:{id,organizationId:r.actor.organizationId,value:1},update:{value:{increment:1}}});
 return prefix+'-'+r.storeId.slice(0,8).toUpperCase()+'-'+String(seq.value).padStart(6,'0');
}
export async function createBooking(r:AuthedRequest,body:unknown) {
 allow(r,deskRoles);const input=bookingInput.parse(body);
 return command(r,'appointment.create',input,async tx=>{
  const customer=await tx.customer.findFirst({where:{id:input.customerId,organizationId:r.actor.organizationId,active:true}});
  const service=await tx.catalogItem.findFirst({where:{id:input.serviceId,organizationId:r.actor.organizationId,type:'SERVICE',active:true}});
  const provider=await tx.user.findFirst({where:{id:input.providerId,organizationId:r.actor.organizationId,active:true,role:{in:['ADMIN','MANAGER','THERAPIST']}}});
  if(!customer||!service||!provider||!(provider.storeIds as string[]).includes(r.storeId)) throw new BadRequestException('Customer, service or therapist is unavailable at this store');
  await tx.$queryRaw`SELECT id FROM User WHERE id = ${provider.id} FOR UPDATE`;
  const startsAt=new Date(input.startsAt),endsAt=new Date(startsAt.getTime()+service.duration*60000);
  if(startsAt.getTime()<Date.now()-60000) throw new BadRequestException('Appointment must start in the future');
  const store=await tx.store.findUniqueOrThrow({where:{id:r.storeId}});
  const start=storeTime(startsAt,store.timezone),end=storeTime(endsAt,store.timezone);
  if(start.day!==end.day||start.time<store.opensAt||end.time>store.closesAt) throw new BadRequestException('Appointment falls outside store opening hours');
  const overlap=await tx.appointment.findFirst({where:{organizationId:r.actor.organizationId,providerId:provider.id,status:{notIn:['CANCELLED','NO_SHOW']},startsAt:{lt:endsAt},endsAt:{gt:startsAt}}});
  if(overlap) throw new ConflictException('Therapist is already booked during this time');
  const appointment=await tx.appointment.create({data:{...scope(r),...input,startsAt,endsAt,timezone:store.timezone,createdBy:r.actor.id,updatedBy:r.actor.id}});
  await event(tx,r,appointment.id,'AppointmentConfirmed');
  return appointment;
 });
}
export async function transitionBooking(r:AuthedRequest,id:string,body:unknown) {
 uuid.parse(id);allow(r,['ADMIN','MANAGER','RECEPTION','THERAPIST']);
 const input=z.object({status:z.enum(['CHECKED_IN','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW']),version:z.number().int().positive()}).strict().parse(body);
 return command(r,'appointment.transition:'+id,input,async tx=>{
  const row=await tx.appointment.findFirst({where:{id,...scope(r)}});
  if(!row) throw new NotFoundException();
  if(r.actor.role==='THERAPIST'&&row.providerId!==r.actor.id) throw new NotFoundException();
  if(row.version!==input.version) throw new ConflictException('Appointment changed. Refresh and retry');
  if(!transitions[row.status]?.includes(input.status)) throw new ConflictException('Invalid appointment transition');
  const result=await tx.appointment.update({where:{id},data:{status:input.status,version:{increment:1},updatedBy:r.actor.id}});
  await tx.statusHistory.create({data:{organizationId:r.actor.organizationId,entityId:id,fromStatus:row.status,toStatus:input.status,actorId:r.actor.id}});
  await event(tx,r,id,'Appointment'+input.status);
  return result;
 });
}
export async function postInvoice(r:AuthedRequest,body:unknown) {
 allow(r,deskRoles);const input=invoiceInput.parse(body);
 const limit=managerRoles.includes(r.actor.role)?100:10;
 if(Number(input.discountPercent)>limit) throw new BadRequestException('Discount exceeds your permitted '+limit+'% limit');
 return command(r,'invoice.post',input,async tx=>{
  const customer=await tx.customer.findFirst({where:{id:input.customerId,organizationId:r.actor.organizationId,active:true}});
  if(!customer) throw new BadRequestException('Customer not found');
  if(input.appointmentId) {
   const appt=await tx.appointment.findFirst({where:{id:input.appointmentId,...scope(r),customerId:input.customerId,status:'COMPLETED'}});
   if(!appt) throw new BadRequestException('Only a completed appointment for this customer can be billed');
   if(!input.items.some(i=>i.catalogItemId===appt.serviceId)) throw new BadRequestException('Invoice must include the appointment service');
  }
  const lines: Array<{organizationId:string;catalogItemId:string;description:string;type:string;quantity:number;unitPrice:Prisma.Decimal;taxRate:Prisma.Decimal;subtotal:string;discount:string;tax:string;total:string}>=[];
  for(const line of input.items) {
   const item=await tx.catalogItem.findFirst({where:{id:line.catalogItemId,organizationId:r.actor.organizationId,active:true}});
   if(!item) throw new BadRequestException('Catalog item unavailable');
   const totals=calculateLine(item.price.toFixed(2),line.quantity,item.taxRate.toFixed(2),input.discountPercent);
   lines.push({organizationId:r.actor.organizationId,catalogItemId:item.id,description:item.name,type:item.type,quantity:line.quantity,unitPrice:item.price,taxRate:item.taxRate,...totals});
  }
  const sum=(key:'subtotal'|'discount'|'tax'|'total')=>major(lines.reduce((n,l)=>n+minor(l[key]),0n));
  const invoice=await tx.invoice.create({data:{...scope(r),customerId:input.customerId,appointmentId:input.appointmentId,number:await number(tx,r,'INV'),subtotal:sum('subtotal'),discountTotal:sum('discount'),taxTotal:sum('tax'),grandTotal:sum('total'),dueTotal:sum('total'),createdBy:r.actor.id,updatedBy:r.actor.id,items:{create:lines.map(({subtotal,...line})=>line)}},include:{items:true}});
  for(const line of lines.filter(l=>l.type==='PRODUCT')) {
   const changed=await tx.stockBalance.updateMany({where:{...scope(r),productId:line.catalogItemId,onHand:{gte:line.quantity}},data:{onHand:{decrement:line.quantity},version:{increment:1}}});
   if(changed.count!==1) throw new ConflictException('Insufficient stock for '+line.description);
   await tx.stockLedger.create({data:{...scope(r),productId:line.catalogItemId,quantity:-line.quantity,type:'SALE',referenceId:invoice.id,reason:'Invoice '+invoice.number,createdBy:r.actor.id}});
  }
  await event(tx,r,invoice.id,'InvoicePosted');
  return invoice;
 });
}
async function allocate(tx:Tx,r:AuthedRequest,invoiceId:string,amount:Prisma.Decimal) {
 const row=await tx.invoice.findFirstOrThrow({where:{id:invoiceId,...scope(r)}});
 if(amount.gt(row.dueTotal)) throw new ConflictException('Payment exceeds the outstanding amount');
 await tx.invoice.update({where:{id:row.id},data:{paidTotal:{increment:amount},dueTotal:{decrement:amount},version:{increment:1},updatedBy:r.actor.id}});
}
export async function recordPayment(r:AuthedRequest,body:unknown) {
 allow(r,deskRoles);const input=paymentInput.parse(body);
 return command(r,'payment.record',input,async tx=>{
  const invoice=await tx.invoice.findFirst({where:{id:input.invoiceId,...scope(r),status:'POSTED'}});
  if(!invoice) throw new NotFoundException('Invoice not found');
  const amount=new Prisma.Decimal(input.amount);
  const pending=await tx.payment.aggregate({where:{invoiceId:invoice.id,status:'PENDING_VERIFICATION'},_sum:{amount:true}});
  if(amount.gt(invoice.dueTotal.sub(pending._sum.amount||0))) throw new ConflictException('Amount exceeds unallocated balance, including pending UPI');
  const cash=input.method==='CASH';
  const payment=await tx.payment.create({data:{...scope(r),...input,reference:cash?null:input.reference!.toUpperCase(),status:cash?'PAID':'PENDING_VERIFICATION',receiptNumber:cash?await number(tx,r,'RCT'):null,createdBy:r.actor.id,updatedBy:r.actor.id}});
  if(cash) await allocate(tx,r,invoice.id,amount);
  await event(tx,r,payment.id,cash?'PaymentCaptured':'PaymentVerificationRequired');
  return payment;
 });
}
export async function verifyPayment(r:AuthedRequest,id:string,body:unknown) {
 allow(r,managerRoles);uuid.parse(id);
 const input=z.object({decision:z.enum(['VERIFY','REJECT']),version:z.number().int().positive(),reason:z.string().trim().max(500).optional()}).strict().refine(v=>v.decision!=='REJECT'||(v.reason?.length||0)>=5,{message:'Rejection requires a reason'}).parse(body);
 return command(r,'payment.verify:'+id,input,async tx=>{
  const row=await tx.payment.findFirst({where:{id,...scope(r)}});
  if(!row) throw new NotFoundException();
  if(row.status!=='PENDING_VERIFICATION'||row.version!==input.version) throw new ConflictException('Payment has already changed');
  if(input.decision==='VERIFY') await allocate(tx,r,row.invoiceId,row.amount);
  const status=input.decision==='VERIFY'?'PAID':'REJECTED';
  const payment=await tx.payment.update({where:{id},data:{status,verifiedBy:r.actor.id,reason:input.reason,receiptNumber:status==='PAID'?await number(tx,r,'RCT'):null,updatedBy:r.actor.id,version:{increment:1}}});
  await tx.statusHistory.create({data:{organizationId:r.actor.organizationId,entityId:id,fromStatus:row.status,toStatus:status,actorId:r.actor.id}});
  await event(tx,r,id,status==='PAID'?'PaymentCaptured':'PaymentRejected');
  return payment;
 });
}
export async function receiveStock(r:AuthedRequest,body:unknown) {
 allow(r,['ADMIN','MANAGER','INVENTORY']);const input=stockInput.parse(body);
 return command(r,'stock.receive',input,async tx=>{
  const product=await tx.catalogItem.findFirst({where:{id:input.productId,organizationId:r.actor.organizationId,type:'PRODUCT',active:true}});
  if(!product) throw new BadRequestException('Product not found');
  const ledger=await tx.stockLedger.create({data:{...scope(r),...input,type:'RECEIPT',referenceId:r.headers['idempotency-key'] as string,createdBy:r.actor.id}});
  await tx.stockBalance.upsert({where:{storeId_productId:{storeId:r.storeId,productId:input.productId}},create:{...scope(r),productId:input.productId,onHand:input.quantity},update:{onHand:{increment:input.quantity},version:{increment:1}}});
  await event(tx,r,ledger.id,'StockReceived');
  return ledger;
 });
}
