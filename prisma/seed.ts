import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {hash} from 'bcryptjs';
const db = new PrismaClient();
async function main() {
 const password=process.env.SEED_ADMIN_PASSWORD;
 if(!password || password.length<12 || password.includes('SET_A_UNIQUE')) throw new Error('Set SEED_ADMIN_PASSWORD to a unique password of 12 or more characters');
 if(await db.user.findUnique({where:{username:'admin'}})) { console.log('Already seeded; no existing data changed.'); return; }
 await db.$transaction(async tx=>{
 const org=await tx.organization.create({data:{name:'Vayyom Spa'}});
 const store=await tx.store.create({data:{organizationId:org.id,name:'Vayyom · Main studio'}});
 const admin=await tx.user.create({data:{organizationId:org.id,username:'admin',name:'Spa Administrator',passwordHash:await hash(password,12),role:'ADMIN',storeIds:[store.id]}});
 for(const item of [
  {name:'Swedish Relaxation',type:'SERVICE',price:'1800.00',taxRate:'18.00',duration:60},
  {name:'Deep Tissue Therapy',type:'SERVICE',price:'2400.00',taxRate:'18.00',duration:90},
  {name:'Signature Facial',type:'SERVICE',price:'1600.00',taxRate:'18.00',duration:45},
  {name:'Aromatherapy Oil',type:'PRODUCT',price:'650.00',taxRate:'18.00',sku:'OIL-001'},
  {name:'Botanical Body Scrub',type:'PRODUCT',price:'850.00',taxRate:'18.00',sku:'SCRUB-001'}
 ]) await tx.catalogItem.create({data:{...item,organizationId:org.id,createdBy:admin.id,updatedBy:admin.id}});
 });
 console.log('Created organization, main store, admin, and sample catalog. No financial or customer data seeded.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
