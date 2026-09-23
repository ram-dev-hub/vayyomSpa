import {CanActivate,ExecutionContext,Injectable,UnauthorizedException,ForbiddenException} from '@nestjs/common';
import {Request} from 'express';
import {verify,sign} from 'jsonwebtoken';
import {db} from './db';
import type {Role} from '@vayyom/shared';
export type Actor={id:string;organizationId:string;name:string;role:Role;storeIds:string[];sessionVersion:number};
export type AuthedRequest=Request&{actor:Actor;storeId:string;traceId:string};
export function tokenFor(actor:Actor) {return sign({sub:actor.id,sv:actor.sessionVersion},process.env.JWT_SECRET!,{expiresIn:'30m',issuer:'vayyom-api',audience:'vayyom-app'});}
@Injectable()
export class AuthGuard implements CanActivate {
 async canActivate(context:ExecutionContext) {
  const req=context.switchToHttp().getRequest<AuthedRequest>();
  const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!token) throw new UnauthorizedException('Sign in to continue');
  try {
   const claims=verify(token,process.env.JWT_SECRET!,{issuer:'vayyom-api',audience:'vayyom-app',algorithms:['HS256']}) as {sub:string;sv:number};
   const user=await db.user.findUnique({where:{id:claims.sub}});
   if(!user?.active||user.sessionVersion!==claims.sv) throw new Error();
   req.actor={id:user.id,organizationId:user.organizationId,name:user.name,role:user.role as Role,storeIds:user.storeIds as string[],sessionVersion:user.sessionVersion};
  } catch {throw new UnauthorizedException('Session expired. Please sign in again');}
  const requested=req.headers['x-store-id'];
  req.storeId=typeof requested==='string'?requested:req.actor.storeIds[0];
  if(!req.storeId||!req.actor.storeIds.includes(req.storeId)) throw new ForbiddenException('Store access denied');
  const store=await db.store.findFirst({where:{id:req.storeId,organizationId:req.actor.organizationId,active:true}});
  if(!store) throw new ForbiddenException('Store is unavailable');
  return true;
 }
}
export function allow(req:AuthedRequest,roles:Role[]) {if(!roles.includes(req.actor.role)) throw new ForbiddenException('Your role cannot perform this action');}
export const staffRoles:Role[]=['ADMIN','MANAGER','RECEPTION','THERAPIST','INVENTORY'];
export const deskRoles:Role[]=['ADMIN','MANAGER','RECEPTION'];
export const managerRoles:Role[]=['ADMIN','MANAGER'];
