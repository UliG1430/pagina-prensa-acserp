import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {createClient} from '@supabase/supabase-js';
import ContentModel from '../../content-model.js';
import initialContent from '../../content.json' with {type:'json'};
import contentAssets from '../../content-assets/manifest.json' with {type:'json'};

const JSON_LIMIT=5.5*1024*1024,CHUNK_LIMIT=2.5*1024*1024,IMAGE_LIMIT=20*1024*1024,SESSION_TTL=8*60*60*1000;
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const error=(message,status=400)=>json({error:message},status);
const cookieName=local=>local?'prensa_local_session':'__Host-prensa_session';
const cookie=(value,local,maxAge)=>`${cookieName(local)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local?'':'; Secure'}`;

function sameOrigin(request){return request.headers.get('origin')===new URL(request.url).origin&&request.headers.get('sec-fetch-site')!=='cross-site';}
function parseCookie(request,name){return (request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);}
function sessionStoreKey(value){return `session/${crypto.createHash('sha256').update(value).digest('hex')}`;}
function authClient(){return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})}});}
const isAdmin=user=>user?.app_metadata?.role==='admin';
const credentialErrors=new Set(['invalid_credentials','email_not_confirmed','user_banned']);
function imageExtension(bytes){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))return 'gif';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'webp';return null;}
function externalizeKnownImages(content){let changed=false;const copy=structuredClone(content);for(const type of ['diarios','entrevistas','noticieros'])for(const item of (copy[type]||[]).flat())item.imagenes=(item.imagenes||[]).map(source=>{const match=/^data:([^;,]+);base64,(.+)$/s.exec(source);if(!match)return source;const digest=crypto.createHash('sha256').update(Buffer.from(match[2],'base64')).digest('hex'),replacement=contentAssets[`${match[1]}:${digest}`];if(replacement)changed=true;return replacement||source;});return {content:copy,changed};}

async function requestJSON(request){if(Number(request.headers.get('content-length')||0)>JSON_LIMIT)throw Object.assign(new Error('El contenido supera el límite de Netlify.'),{status:413});const text=await request.text();if(Buffer.byteLength(text)>JSON_LIMIT)throw Object.assign(new Error('El contenido supera el límite de Netlify.'),{status:413});return JSON.parse(text);}
async function rateLimit(store,id,limit,windowMs){const key='rate/'+crypto.createHash('sha256').update(id).digest('hex'),now=Date.now(),current=await store.getWithMetadata(key,{type:'json',consistency:'strong'});const value=current?.data?.until>now?current.data:{count:0,until:now+windowMs};if(value.count>=limit)return false;value.count++;const result=await store.setJSON(key,value,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});return result.modified||rateLimit(store,id,limit,windowMs);}
async function authorized(request,local,sessionStore){
  const raw=parseCookie(request,cookieName(local));
  if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;
  const key=sessionStoreKey(raw),saved=await sessionStore.get(key,{type:'json',consistency:'strong'});
  if(!saved||saved.until<Date.now()){if(saved)await sessionStore.delete(key);return null;}
  const client=authClient(),{data:set,error:setError}=await client.auth.setSession({access_token:saved.access,refresh_token:saved.refresh});
  if(setError||!set.session){await sessionStore.delete(key);return null;}
  const {data,error:userError}=await client.auth.getUser();
  if(userError||!isAdmin(data.user)||data.user.id!==saved.userId){await sessionStore.delete(key);return null;}
  await sessionStore.setJSON(key,{access:set.session.access_token,refresh:set.session.refresh_token,userId:data.user.id,until:saved.until});
  return {client,user:data.user,session:set.session,key,cookie:cookie(raw,local,Math.max(0,Math.floor((saved.until-Date.now())/1000)))};
}

export default async function handler(request,context){
  const url=new URL(request.url),local=url.protocol!=='https:',contentStore=getStore({name:'prensa-content',consistency:'strong'}),uploadStore=getStore('prensa-uploads'),sessionStore=getStore({name:'prensa-sessions',consistency:'strong'});
  try{
    if(!process.env.SUPABASE_URL||!process.env.SUPABASE_PUBLISHABLE_KEY)return error('Falta configurar Supabase.',503);
    if(request.method==='GET'&&url.pathname==='/api/content'){const saved=await contentStore.get('current',{type:'json',consistency:'strong'}),migrated=externalizeKnownImages(saved||initialContent),content=ContentModel.normalize(migrated.content);if(saved&&migrated.changed)await contentStore.setJSON('current',content);return json(content,200,{'Cache-Control':'public, max-age=0, must-revalidate','Netlify-CDN-Cache-Control':'public, durable, s-maxage=10, must-revalidate'});}
    if(request.method==='GET'&&/^\/uploads\/[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(url.pathname)){const entry=await uploadStore.getWithMetadata(url.pathname.slice(1),{type:'stream'});return entry?new Response(entry.data,{headers:{'Content-Type':entry.metadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}}):new Response('No encontrado.',{status:404});}
    if(!['POST','PUT'].includes(request.method))return error('Método no permitido.',405);
    if(!sameOrigin(request))return error('Origen no autorizado.',403);
    if(request.method==='POST'&&url.pathname==='/api/login'){
      const ip=context.ip||request.headers.get('x-nf-client-connection-ip')||'unknown';if(!await rateLimit(contentStore,'login:'+ip,20,15*60*1000))return error('Demasiados intentos. Probá más tarde.',429);
      const body=await requestJSON(request);if(typeof body.email!=='string'||typeof body.password!=='string'||!body.email.trim()||!body.password)return error('Correo o contraseña incorrectos.',401);
      const client=authClient(),{data, error:loginError}=await client.auth.signInWithPassword({email:body.email.trim(),password:body.password});
      if(loginError){const code=loginError.code||'auth_unavailable';console.warn('[auth/login]',code,loginError.status||'');if(code==='over_request_rate_limit'||code==='over_email_send_rate_limit'||loginError.status===429)return error('Demasiados intentos. Esperá unos minutos antes de volver a ingresar.',429);if(credentialErrors.has(code))return error('Supabase rechazó el correo o la contraseña. Usá las credenciales actuales de la web de ACSERP.',401);return error('No se pudo conectar con Supabase. Verificá SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en Netlify.',502);}
      if(!data.session)return error('Supabase no devolvió una sesión válida.',502);if(!isAdmin(data.user))return error('Tu cuenta no tiene permisos de administrador.',403);
      const previous=parseCookie(request,cookieName(local));if(previous&&/^[a-f0-9]{64}$/.test(previous))await sessionStore.delete(sessionStoreKey(previous));
      const until=Date.now()+SESSION_TTL,token=crypto.randomBytes(32).toString('hex');
      await sessionStore.setJSON(sessionStoreKey(token),{access:data.session.access_token,refresh:data.session.refresh_token,userId:data.user.id,until});
      return json({ok:true},200,{'Set-Cookie':cookie(token,local,SESSION_TTL/1000)});
    }
    if(request.method==='POST'&&url.pathname==='/api/logout'){
      const auth=await authorized(request,local,sessionStore);if(auth){await sessionStore.delete(auth.key);await auth.client.auth.signOut({scope:'local'});}
      return json({ok:true},200,{'Set-Cookie':cookie('',local,0)});
    }
    const auth=await authorized(request,local,sessionStore);if(!auth)return error('La sesión venció. Volvé a ingresar.',401);
    if(request.method==='PUT'&&url.pathname==='/api/content'){const content=externalizeKnownImages(await requestJSON(request)).content;if(!ContentModel.valid(content))return error('Contenido inválido.',400);await contentStore.setJSON('current',content);return json({ok:true},200,{'Set-Cookie':auth.cookie});}
    if(request.method==='POST'&&url.pathname==='/api/images'){
      const id=request.headers.get('x-upload-id'),part=Number(request.headers.get('x-upload-part')),parts=Number(request.headers.get('x-upload-parts'));
      if(!/^[a-f0-9-]{36}$/.test(id||'')||!Number.isInteger(part)||!Number.isInteger(parts)||part<0||parts<1||parts>10||part>=parts)return error('Carga inválida.',400);
      const bytes=Buffer.from(await request.arrayBuffer());if(bytes.length>CHUNK_LIMIT)return error('El fragmento supera el límite.',413);
      await uploadStore.set(`temp/${id}/${part}`,bytes,{metadata:{expires:Date.now()+3600000}});
      if(part!==parts-1)return json({ok:true,part},202,{'Set-Cookie':auth.cookie});
      const chunks=[];let size=0;for(let i=0;i<parts;i++){const chunk=await uploadStore.get(`temp/${id}/${i}`,{type:'arrayBuffer',consistency:'strong'});if(!chunk)return error('Falta un fragmento de la imagen.',409);const buffer=Buffer.from(chunk);size+=buffer.length;if(size>IMAGE_LIMIT)return error('La imagen supera el límite de 20 MB.',413);chunks.push(buffer);}
      const image=Buffer.concat(chunks),extension=imageExtension(image);if(!extension)return error('Usá una imagen JPG, PNG, WebP o GIF.',415);
      const filename=`${crypto.randomUUID()}.${extension}`,key=`uploads/${filename}`,contentType={png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[extension];await uploadStore.set(key,image,{metadata:{contentType}});await Promise.all(Array.from({length:parts},(_,i)=>uploadStore.delete(`temp/${id}/${i}`)));
      return json({url:`/${key}`},201,{'Set-Cookie':auth.cookie});
    }
    return error('Ruta no encontrada.',404);
  }catch(cause){console.error('[prensa]',cause.code||cause.name);return error(cause.status===413?cause.message:'No se pudo completar la operación.',cause.status||500);}
}
