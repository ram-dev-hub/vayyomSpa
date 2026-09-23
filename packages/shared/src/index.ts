export type Role = 'ADMIN' | 'MANAGER' | 'RECEPTION' | 'THERAPIST' | 'INVENTORY' | 'CUSTOMER';
export type Session = { token: string; user: { id: string; name: string; role: Role; storeIds: string[]; customerId?: string } };
export type Field = { key: string; label: string; type?: 'text'|'number'|'date'|'datetime-local'|'checkbox'; required?: boolean };
export type ModuleDefinition = { key: string; title: string; group: string; fields: Field[]; roles: Role[]; transitions?: Record<string,string[]> };
export const modules: ModuleDefinition[] = [
 {key:'customers',title:'Customers',group:'Experience',roles:['ADMIN','MANAGER','RECEPTION'],fields:[{key:'name',label:'Full name',required:true},{key:'mobile',label:'Mobile number',required:true},{key:'email',label:'Email'},{key:'marketingConsent',label:'Marketing consent',type:'checkbox'}]},
 {key:'services',title:'Services',group:'Administration',roles:['ADMIN','MANAGER'],fields:[{key:'name',label:'Service name',required:true},{key:'price',label:'Price (INR)',type:'number',required:true},{key:'duration',label:'Duration (minutes)',type:'number',required:true},{key:'taxRate',label:'Tax rate (%)',type:'number',required:true}]},
 {key:'products',title:'Products',group:'Inventory',roles:['ADMIN','MANAGER'],fields:[{key:'name',label:'Product name',required:true},{key:'sku',label:'SKU',required:true},{key:'price',label:'Price (INR)',type:'number',required:true},{key:'taxRate',label:'Tax rate (%)',type:'number',required:true},{key:'minimumStock',label:'Minimum stock',type:'number',required:true}]}
];
export const money = (value: string|number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(value));
export function minor(value: unknown): bigint {
 const text = String(value);
 if(!/^\d{1,10}(\.\d{1,2})?$/.test(text)) throw new Error('Amount must be non-negative with at most two decimal places');
 const [whole,fraction=''] = text.split('.');
 return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function major(value: bigint):string { return (value/100n).toString()+'.'+(value%100n).toString().padStart(2,'0'); }
export function calculateLine(price:string,quantity:number,taxRate:string,discountPercent:string='0') {
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000) throw new Error('Invalid quantity');
 const discount = minor(discountPercent), rate=minor(taxRate);
 if(discount>10000n||rate>10000n) throw new Error('Invalid percentage');
 const subtotal=minor(price)*BigInt(quantity), reduction=(subtotal*discount+5000n)/10000n;
 const taxable=subtotal-reduction, tax=(taxable*rate+5000n)/10000n;
 return {subtotal:major(subtotal),discount:major(reduction),tax:major(tax),total:major(taxable+tax)};
}

export {createClient,ApiError} from './client';
