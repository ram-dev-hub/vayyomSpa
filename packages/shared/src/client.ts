import type {Session} from './index';
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export function createClient(baseUrl:string,getSession:()=>Session|null,getStore:()=>string) {
 const keys=new Map<string,string>();
 return async function request<T=any>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T> {
  const session=getSession(),store=getStore();
  const signature=JSON.stringify([session?.user.id,store,path,method,body]);
  let key=keys.get(signature);
  if(body!==undefined&&!key) {
   key=globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
   keys.set(signature,key);
  }
  const response=await fetch(baseUrl+path,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{}),...(store?{'X-Store-Id':store}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) {
   if(response.status<500 && response.status!==409) keys.delete(signature);
   throw new ApiError(response.status,data.detail||'Request failed');
  }
  keys.delete(signature);
  return data;
 };
}
