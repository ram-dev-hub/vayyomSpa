import 'reflect-metadata';
import 'dotenv/config';
import {NestFactory} from '@nestjs/core';
import {Module,Controller,Get,Post,Patch,Body,Param,Query,Req,UseGuards,Catch,ExceptionFilter,ArgumentsHost,HttpException,UnauthorizedException,ConflictException,BadRequestException,NotFoundException} from '@nestjs/common';
import {SwaggerModule,DocumentBuilder,ApiBearerAuth,ApiHeader} from '@nestjs/swagger';
import {Request,Response,NextFunction} from 'express';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {compare,hash} from 'bcryptjs';
import {z,ZodError} from 'zod';
import {Prisma} from '@prisma/client';
import {db} from './db';
import {AuthGuard,AuthedRequest,Actor,tokenFor,allow,deskRoles,managerRoles,staffRoles} from './auth';
import {customerInput,catalogInput,uuid} from './validation';
import {scope,audit,command,createBooking,transitionBooking,postInvoice,recordPayment,verifyPayment,receiveStock} from './service';
const loginAttempts=new Map<string,{count:number;until:number}>();
@Controller('api/v1')
class PublicController {
 @Get('health') async health() {await db.$queryRaw`SELECT 1`;return {status:'ok',database:'mysql',time:new Date().toISOString()};}
 @Post('auth/login') async login(@Body() body:unknown,@Req() req:Request) {
  const input=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(128)}).strict().parse(body);
  const now=Date.now(),ip=req.ip||'local';
  for(const [key,entry] of loginAttempts) if(entry.until<now) loginAttempts.delete(key);
  const attempts=loginAttempts.get(ip)||{count:0,until:now+15*60000};
  attempts.count++;loginAttempts.set(ip,attempts);
  if(attempts.count>30) throw new HttpException('Too many sign-in attempts. Try again later',429);
  const user=await db.user.findUnique({where:{username:input.username}});
  if(!user?.active|| (user.lockedUntil&&user.lockedUntil.getTime()>now)) throw new UnauthorizedException('Invalid credentials or account temporarily locked');
  if(!await compare(input.password,user.passwordHash)) {
   await db.user.update({where:{id:user.id},data:{failedAttempts:{increment:1},lockedUntil:user.failedAttempts>=4?new Date(now+15*60000):undefined}});
   throw new UnauthorizedException('Invalid credentials or account temporarily locked');
  }
  await db.user.update({where:{id:user.id},data:{failedAttempts:0,lockedUntil:null}});
  const actor:Actor={id:user.id,organizationId:user.organizationId,name:user.name,role:user.role as Actor['role'],storeIds:user.storeIds as string[],sessionVersion:user.sessionVersion};
  return {token:tokenFor(actor),user:{id:actor.id,name:actor.name,role:actor.role,storeIds:actor.storeIds}};
 }
}
@ApiBearerAuth()
@ApiHeader({name:'X-Store-Id',required:true})
@UseGuards(AuthGuard)
@Controller('api/v1')
class AppController {
 @Get('auth/me') me(@Req() r:AuthedRequest) {return {id:r.actor.id,name:r.actor.name,role:r.actor.role,storeIds:r.actor.storeIds};}
 @Post('auth/logout') async logout(@Req() r:AuthedRequest) {await db.user.update({where:{id:r.actor.id},data:{sessionVersion:{increment:1}}});return {ok:true};}
 @Post('auth/password') async password(@Req() r:AuthedRequest,@Body() body:unknown) {
  const input=z.object({currentPassword:z.string().max(128),newPassword:z.string().min(12).max(128)}).strict().parse(body);
  const user=await db.user.findUniqueOrThrow({where:{id:r.actor.id}});
  if(!await compare(input.currentPassword,user.passwordHash)) throw new UnauthorizedException('Current password is incorrect');
  await db.$transaction(async tx=>{await tx.user.update({where:{id:r.actor.id},data:{passwordHash:await hash(input.newPassword,12),sessionVersion:{increment:1}}});await audit(tx,r,r.actor.id,'PasswordChanged');});
  return {ok:true};
 }
 @Get('stores') stores(@Req() r:AuthedRequest) {return db.store.findMany({where:{id:{in:r.actor.storeIds},organizationId:r.actor.organizationId,active:true}});}
 @Post('stores') async createStore(@Req() r:AuthedRequest,@Body() body:unknown) {
  allow(r,['ADMIN']);
  const input=z.object({name:z.string().trim().min(2).max(160),timezone:z.string().max(64).default('Asia/Kolkata'),opensAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),closesAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('20:00')}).strict().parse(body);
  try{new Intl.DateTimeFormat('en',{timeZone:input.timezone});}catch{throw new BadRequestException('Invalid timezone');}
  if(input.opensAt>=input.closesAt) throw new BadRequestException('Closing time must be after opening time');
  return command(r,'store.create',input,async tx=>{
   const store=await tx.store.create({data:{...input,organizationId:r.actor.organizationId}});
   await tx.$queryRaw`SELECT id FROM User WHERE id = ${r.actor.id} FOR UPDATE`;
   const user=await tx.user.findUniqueOrThrow({where:{id:r.actor.id}});
   await tx.user.update({where:{id:user.id},data:{storeIds:[...(user.storeIds as string[]),store.id]}});
   await audit(tx,r,store.id,'StoreCreated');return store;
  });
 }
 @Get('employees') async employees(@Req() r:AuthedRequest) {
  allow(r,staffRoles);
  const users=await db.user.findMany({where:{organizationId:r.actor.organizationId,active:true},select:{id:true,name:true,role:true,storeIds:true}});
  return users.filter(u=>(u.storeIds as string[]).includes(r.storeId)).map(({storeIds,...u})=>u);
 }
 @Post('employees') async createEmployee(@Req() r:AuthedRequest,@Body() body:unknown) {
  allow(r,['ADMIN']);
  const input=z.object({username:z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),name:z.string().trim().min(2).max(160),password:z.string().min(12).max(128),role:z.enum(['MANAGER','RECEPTION','THERAPIST','INVENTORY'])}).strict().parse(body);
  const {password,...fields}=input;
  return db.$transaction(async tx=>{
   const user=await tx.user.create({data:{...fields,organizationId:r.actor.organizationId,passwordHash:await hash(password,12),storeIds:[r.storeId]},select:{id:true,name:true,role:true}});
   await audit(tx,r,user.id,'EmployeeCreated');return user;
  });
 }
 @Get('customers') customers(@Req() r:AuthedRequest,@Query('search') search='',@Query('cursor') cursor?:string) {
  allow(r,deskRoles);if(cursor)uuid.parse(cursor);
  return db.customer.findMany({where:{organizationId:r.actor.organizationId,active:true,...(cursor?{id:{gt:cursor}}:{}),OR:[{name:{contains:search.slice(0,100)}},{mobile:{contains:search.slice(0,100)}}]},orderBy:{id:'asc'},take:100});
 }
 @Post('customers') async customer(@Req() r:AuthedRequest,@Body() body:unknown) {
  allow(r,deskRoles);const input=customerInput.parse(body);
  return db.$transaction(async tx=>{const row=await tx.customer.create({data:{...input,email:input.email||null,organizationId:r.actor.organizationId,createdBy:r.actor.id,updatedBy:r.actor.id}});await audit(tx,r,row.id,'CustomerCreated');return row;});
 }
 @Patch('customers/:id') async updateCustomer(@Req() r:AuthedRequest,@Param('id') id:string,@Body() body:unknown) {
  allow(r,deskRoles);uuid.parse(id);const input=customerInput.extend({version:z.number().int().positive()}).parse(body);
  return db.$transaction(async tx=>{const {version,...data}=input;const changed=await tx.customer.updateMany({where:{id,organizationId:r.actor.organizationId,version},data:{...data,email:data.email||null,updatedBy:r.actor.id,version:{increment:1}}});if(!changed.count)throw new ConflictException('Customer changed or unavailable');await audit(tx,r,id,'CustomerUpdated');return tx.customer.findUnique({where:{id}});});
 }
 @Get('services') services(@Req() r:AuthedRequest) {return this.catalog(r,'SERVICE');}
 @Get('products') products(@Req() r:AuthedRequest) {return this.catalog(r,'PRODUCT');}
 private catalog(r:AuthedRequest,type:string) {return db.catalogItem.findMany({where:{organizationId:r.actor.organizationId,type,active:true},orderBy:{name:'asc'},take:500});}
 @Post('services') service(@Req() r:AuthedRequest,@Body() body:unknown) {return this.createCatalog(r,'SERVICE',body);}
 @Post('products') product(@Req() r:AuthedRequest,@Body() body:unknown) {return this.createCatalog(r,'PRODUCT',body);}
 private async createCatalog(r:AuthedRequest,type:string,body:unknown) {
  allow(r,managerRoles);const input=catalogInput.parse(body);if(type==='PRODUCT'&&!input.sku)throw new BadRequestException('Product SKU is required');
  return db.$transaction(async tx=>{const row=await tx.catalogItem.create({data:{...input,type,organizationId:r.actor.organizationId,createdBy:r.actor.id,updatedBy:r.actor.id}});await audit(tx,r,row.id,'CatalogItemCreated');return row;});
 }
 @Get('appointments') async appointments(@Req() r:AuthedRequest,@Query('from') from?:string,@Query('to') to?:string) {
  allow(r,['ADMIN','MANAGER','RECEPTION','THERAPIST']);
  const start=from?z.coerce.date().parse(from):new Date(Date.now()-86400000*7),end=to?z.coerce.date().parse(to):new Date(Date.now()+86400000*30);
  if(end.getTime()-start.getTime()>93*86400000||end<=start)throw new BadRequestException('Use a date range of at most 93 days');
  const rows=await db.appointment.findMany({where:{...scope(r),startsAt:{gte:start,lt:end},...(r.actor.role==='THERAPIST'?{providerId:r.actor.id}:{})},orderBy:{startsAt:'asc'},take:500});
  const customers=await db.customer.findMany({where:{organizationId:r.actor.organizationId,id:{in:rows.map(x=>x.customerId)}},select:{id:true,name:true}});
  const services=await db.catalogItem.findMany({where:{organizationId:r.actor.organizationId,id:{in:rows.map(x=>x.serviceId)}},select:{id:true,name:true}});
  const invoices=await db.invoice.findMany({where:{...scope(r),appointmentId:{in:rows.map(x=>x.id)}},select:{id:true,appointmentId:true}});
  return rows.map(x=>({...x,invoiceId:invoices.find(i=>i.appointmentId===x.id)?.id,customerName:customers.find(c=>c.id===x.customerId)?.name,serviceName:services.find(s=>s.id===x.serviceId)?.name}));
 }
 @Post('appointments') booking(@Req() r:AuthedRequest,@Body() b:unknown) {return createBooking(r,b);}
 @Post('appointments/:id/transition') transition(@Req() r:AuthedRequest,@Param('id') id:string,@Body() b:unknown) {return transitionBooking(r,id,b);}
 @Get('invoices') invoices(@Req() r:AuthedRequest,@Query('cursor') cursor?:string) {
  allow(r,deskRoles);if(cursor)uuid.parse(cursor);
  return db.invoice.findMany({where:{...scope(r),...(cursor?{id:{gt:cursor}}:{})},include:{items:true,payments:true},orderBy:{id:'asc'},take:100});
 }
 @Get('invoices/:id') async invoice(@Req() r:AuthedRequest,@Param('id') id:string) {
  allow(r,deskRoles);uuid.parse(id);const row=await db.invoice.findFirst({where:{id,...scope(r)},include:{items:true,payments:true}});
  if(!row)throw new NotFoundException();return row;
 }
 @Post('invoices') postInvoice(@Req() r:AuthedRequest,@Body() b:unknown) {return postInvoice(r,b);}
 @Get('payments') payments(@Req() r:AuthedRequest,@Query('cursor') cursor?:string) {
  allow(r,deskRoles);if(cursor)uuid.parse(cursor);
  return db.payment.findMany({where:{...scope(r),...(cursor?{id:{gt:cursor}}:{})},include:{invoice:{select:{number:true}}},orderBy:{id:'asc'},take:100});
 }
 @Post('payments') payment(@Req() r:AuthedRequest,@Body() b:unknown) {return recordPayment(r,b);}
 @Post('payments/:id/verify') verify(@Req() r:AuthedRequest,@Param('id') id:string,@Body() b:unknown) {return verifyPayment(r,id,b);}
 @Get('stock') async stock(@Req() r:AuthedRequest) {
  allow(r,['ADMIN','MANAGER','RECEPTION','INVENTORY']);
  const [products,balances]=await Promise.all([db.catalogItem.findMany({where:{organizationId:r.actor.organizationId,type:'PRODUCT',active:true}}),db.stockBalance.findMany({where:scope(r)})]);
  return products.map(p=>({id:p.id,name:p.name,sku:p.sku,onHand:balances.find(b=>b.productId===p.id)?.onHand||0,minimumStock:p.minimumStock}));
 }
 @Get('stock/ledger') ledger(@Req() r:AuthedRequest,@Query('cursor') cursor?:string) {allow(r,['ADMIN','MANAGER','INVENTORY']);if(cursor)uuid.parse(cursor);return db.stockLedger.findMany({where:{...scope(r),...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:100});}
 @Post('stock/receive') receive(@Req() r:AuthedRequest,@Body() b:unknown) {return receiveStock(r,b);}
 @Get('reports/dashboard') async dashboard(@Req() r:AuthedRequest) {
  allow(r,deskRoles);
  const store=await db.store.findUniqueOrThrow({where:{id:r.storeId}});
  const [sales,payments,pending,appointments,customers,stock]=await db.$transaction([
   db.invoice.aggregate({where:scope(r),_sum:{grandTotal:true,dueTotal:true},_count:true}),
   db.payment.aggregate({where:{...scope(r),status:'PAID'},_sum:{amount:true}}),
   db.payment.count({where:{...scope(r),status:'PENDING_VERIFICATION'}}),
   db.appointment.findMany({where:{...scope(r),startsAt:{gte:new Date()},status:{in:['CONFIRMED','CHECKED_IN','IN_PROGRESS']}},orderBy:{startsAt:'asc'},take:6}),
   db.customer.count({where:{organizationId:r.actor.organizationId,active:true}}),
   db.stockBalance.findMany({where:scope(r)})
  ],{isolationLevel:'RepeatableRead'});
  return {sales:sales._sum.grandTotal||'0',collected:payments._sum.amount||'0',outstanding:sales._sum.dueTotal||'0',invoices:sales._count,pending,customers,appointments,stockUnits:stock.reduce((n,s)=>n+s.onHand,0),lastUpdated:new Date().toISOString(),timezone:store.timezone};
 }
 @Get('admin/audit') audits(@Req() r:AuthedRequest,@Query('cursor') cursor?:string) {allow(r,managerRoles);if(cursor)uuid.parse(cursor);return db.auditEvent.findMany({where:{...scope(r),...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:100});}
 @Get('notifications') notifications(@Req() r:AuthedRequest) {allow(r,managerRoles);return db.outboxEvent.findMany({where:scope(r),orderBy:{createdAt:'desc'},take:100});}
}
@Catch()
class Problems implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost) {
  const ctx=host.switchToHttp(),res=ctx.getResponse<Response>(),req=ctx.getRequest<AuthedRequest>();
  let status=500,detail='Unexpected server error';
  if(error instanceof ZodError) {status=400;detail=error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ');}
  else if(error instanceof HttpException) {status=error.getStatus();detail=error.message;}
  else if(error instanceof Prisma.PrismaClientKnownRequestError) {
   if(error.code==='P2002'){status=409;detail='A record with this unique value already exists';}
   else if(error.code==='P2025'){status=404;detail='Record not found';}
   else if(error.code==='P2034'){status=409;detail='Concurrent update. Retry with the same idempotency key';}
  }
  console.error(JSON.stringify({traceId:req.traceId,status,errorType:error instanceof Error?error.constructor.name:'Unknown'}));
  res.status(status).type('application/problem+json').send({type:'about:blank',title:status===500?'Internal Server Error':'Request could not be completed',status,detail,traceId:req.traceId});
 }
}
@Module({controllers:[PublicController,AppController],providers:[AuthGuard]})
class AppModule {}
async function main() {
 if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32||process.env.JWT_SECRET.includes('REPLACE_')) throw new Error('Configure a random JWT_SECRET of at least 32 characters');
 const app=await NestFactory.create(AppModule);
 app.use(helmet());
 app.enableCors({origin:process.env.WEB_ORIGIN||'http://localhost:5173',allowedHeaders:['Authorization','Content-Type','X-Store-Id','Idempotency-Key','X-Correlation-Id'],exposedHeaders:['X-Correlation-Id']});
 app.use((req:AuthedRequest,res:Response,next:NextFunction)=>{
  req.traceId=randomUUID();res.setHeader('X-Correlation-Id',req.traceId);
  const started=Date.now();res.on('finish',()=>console.log(JSON.stringify({traceId:req.traceId,method:req.method,path:req.path,status:res.statusCode,ms:Date.now()-started})));next();
 });
 app.useGlobalFilters(new Problems());
 const config=new DocumentBuilder().setTitle('Vayyom Spa Phase 1 API').setVersion('1.0').setDescription('Staff operations. Commands require Idempotency-Key; all protected routes accept X-Store-Id. See docs/API.md for request bodies.').addBearerAuth().build();
 SwaggerModule.setup('api/docs',app,SwaggerModule.createDocument(app,config));
 app.enableShutdownHooks();
 await app.listen(Number(process.env.PORT)||4000,'0.0.0.0');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
