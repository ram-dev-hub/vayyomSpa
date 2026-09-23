import {z} from 'zod';
export const uuid=z.string().uuid();
export const amount=z.string().regex(/^\d{1,10}(\.\d{1,2})?$/,'Use an amount with up to two decimal places');
export const customerInput=z.object({name:z.string().trim().min(2).max(160),mobile:z.string().trim().regex(/^\+?[1-9]\d{9,14}$/),email:z.union([z.string().email().max(254),z.literal('')]).optional(),marketingConsent:z.boolean().default(false)}).strict();
export const catalogInput=z.object({name:z.string().trim().min(2).max(160),sku:z.string().trim().min(1).max(80).optional(),price:amount,taxRate:amount.refine(x=>Number(x)<=100),duration:z.coerce.number().int().min(5).max(480).default(60),minimumStock:z.coerce.number().int().min(0).max(100000).default(5)}).strict();
export const bookingInput=z.object({customerId:uuid,serviceId:uuid,providerId:uuid,startsAt:z.string().datetime({offset:true}),notes:z.string().max(500).optional()}).strict();
export const invoiceInput=z.object({customerId:uuid,appointmentId:uuid.optional(),discountPercent:amount.refine(x=>Number(x)<=100).default('0'),items:z.array(z.object({catalogItemId:uuid,quantity:z.number().int().min(1).max(10000)}).strict()).min(1).max(50)}).strict();
export const paymentInput=z.object({invoiceId:uuid,method:z.enum(['CASH','UPI']),amount:amount.refine(x=>Number(x)>0),reference:z.string().trim().min(6).max(100).regex(/^[A-Za-z0-9_-]+$/).optional()}).strict().refine(v=>v.method!=='UPI'||!!v.reference,{message:'UPI requires a transaction reference'});
export const stockInput=z.object({productId:uuid,quantity:z.number().int().min(1).max(100000),reason:z.string().trim().min(5).max(500)}).strict();
export const transitions:Record<string,string[]>={CONFIRMED:['CHECKED_IN','CANCELLED','NO_SHOW'],CHECKED_IN:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['COMPLETED']};
export function storeTime(date:Date,timeZone:string) {
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return {day:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
}
