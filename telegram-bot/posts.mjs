import { telegram } from './telegram.mjs';
export function snapshotPost(message){
  if(message.photo?.length)return {method:'sendPhoto',body:{photo:message.photo.at(-1).file_id,caption:message.caption||'',...(message.caption_entities?{caption_entities:message.caption_entities}:{})}};
  if(message.video)return {method:'sendVideo',body:{video:message.video.file_id,caption:message.caption||'',...(message.caption_entities?{caption_entities:message.caption_entities}:{})}};
  if(message.document)return {method:'sendDocument',body:{document:message.document.file_id,caption:message.caption||'',...(message.caption_entities?{caption_entities:message.caption_entities}:{})}};
  if(message.text)return {method:'sendMessage',body:{text:message.text,...(message.entities?{entities:message.entities}:{})}};
  return null;
}
export function sendPost(env,chat,job,buttons){
  const reply_markup={inline_keyboard:buttons};
  if(job.payload){
    const post=JSON.parse(job.payload);
    return telegram(env,post.method,{...post.body,chat_id:chat,reply_markup});
  }
  return telegram(env,'copyMessage',{chat_id:chat,from_chat_id:job.source_chat,message_id:job.source_message,reply_markup});
}
