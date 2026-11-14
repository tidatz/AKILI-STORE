import {HttpError,isUuid,supa} from './lib.mjs';

export const smsEnvironmentManaged=()=>!!(process.env.EHUB_API_KEY&&process.env.EHUB_API_SECRET&&isUuid(process.env.EHUB_SENDER_ID));
export async function smsConfig(){
 if(smsEnvironmentManaged())return {apiKey:process.env.EHUB_API_KEY,apiSecret:process.env.EHUB_API_SECRET,senderId:process.env.EHUB_SENDER_ID,webhookSecret:process.env.EHUB_WEBHOOK_SECRET};
 return await supa('/rest/v1/rpc/akili_ehub_config_read',{method:'POST',body:{}})||{};
}
export const smsReady=c=>!!(c?.apiKey&&c?.apiSecret&&c?.webhookSecret&&isUuid(c?.senderId));
export const smsStatus=c=>({configured:smsReady(c),api_configured:!!(c?.apiKey&&c?.apiSecret&&isUuid(c?.senderId)),webhook_configured:!!c?.webhookSecret,environment_managed:smsEnvironmentManaged()});
export function smsCredential(value){
 if(typeof value!=='string'||!/^[\x21-\x7e]{8,4096}$/.test(value.trim()))throw new HttpError(400,'Weka ufunguo sahihi kutoka eHub, bila nafasi.');
 return value.trim();
}
export async function storeSmsConfig(actor,values){
 if(smsEnvironmentManaged())throw new HttpError(409,'Funguo hizi zinasimamiwa kwenye usanidi wa server.');
 // Never return values, provider responses or credentials to the browser.
 await supa('/rest/v1/rpc/akili_ehub_config_save',{method:'POST',body:{p_actor:actor.id,p_values:values}});
}
