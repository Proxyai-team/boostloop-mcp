import { decodeScreenshotBase64 } from './proof.ts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const identifier=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const page=z.number().int().min(1).optional();
const taskType=z.enum(['install','store_review','site_review','site_upvote','follow_subscribe','share_repost','video_views','user_testing']);
const platform=z.enum(['android','ios','shopify','wordpress','wix','website']);
const campaignFields={title:z.string().trim().min(1).max(150),task_type:taskType,platform,target_url:z.string().url().max(2048),instructions:z.string().trim().min(1).max(1500),proof_requirements:z.string().trim().min(1).max(1000),slots:z.number().int().min(1).max(10000),reward:z.number().int().min(5).max(100000).optional().describe('Required for user_testing; fixed rewards are enforced for other types.')};
const campaignId={campaign_id:identifier};
const contributionId={contribution_id:identifier};
const reason=z.string().trim().min(1).max(2000);
const statuses=z.enum(['started','submitted','approved','auto_approved','denied','expired']);

export type McpConfig={origin:string;allowedOrigins?:string[];fetch?:typeof fetch};

export async function handleMcp(request:Request,config:McpConfig):Promise<Response>{
 const origin=config.origin.replace(/\/+$/,''),send=config.fetch??fetch;
 const requestOrigin=request.headers.get('origin');
 if(requestOrigin&&!(config.allowedOrigins??[]).includes(requestOrigin))return Response.json({error:'Origin not allowed'}, {status:403});
 const authorization=request.headers.get('authorization');
 const token=authorization?.match(/^Bearer (bl_mcp_[a-f0-9]{64})$/i)?.[1];
 // ponytail: the BoostLoop API validates the token on every call; here only the shape is checked and /api/me confirms it up front.
 const identity=token&&(await send(`${origin}/api/me`,{headers:{Authorization:`Bearer ${token}`}})).ok?{token}:null;
 if(!identity)return Response.json({error:'A valid member MCP token is required'},{status:401,headers:{'WWW-Authenticate':'Bearer realm="BoostLoop"','Cache-Control':'no-store'}});
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 const server=new McpServer({name:'boostloop',version:'1.0.0'},{instructions:'BoostLoop is a free circular karma economy. Use get_campaign to read task and proof requirements before starting. Mutations affect the authenticated member only. Opening/publishing a campaign reserves karma. Approving proof pays its reward; denial needs a reason. Submitted proof is locked. Never claim work that was not performed. Ask the member before creating, publishing, submitting, or deciding work unless they already authorized that action.'});
 async function call(path:string,method='GET',body?:unknown){
  const headers=new Headers({Authorization:`Bearer ${identity!.token}`});
  let payload:BodyInit|undefined;
  if(body instanceof FormData)payload=body;
  else if(body!==undefined){headers.set('Content-Type','application/json');payload=JSON.stringify(body);}
  const response=await send(`${origin}/api/${path}`,{method,headers,body:payload});
  const value=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error(String(value.error||'Action failed'));
  return value;
 }
 function result(value:Record<string,unknown>){return {content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value};}
 function register<Shape extends z.ZodRawShape>(name:string,description:string,schema:Shape,write:boolean,run:(args:z.infer<z.ZodObject<Shape>>)=>Promise<Record<string,unknown>>,destructive=false){
  const inputSchema=z.object(schema);
  server.registerTool<z.ZodRawShape,typeof inputSchema>(name,{description,inputSchema,annotations:{readOnlyHint:!write,destructiveHint:destructive,idempotentHint:!write,openWorldHint:false}},async args=>{
   try{const value=await run(args as z.infer<z.ZodObject<Shape>>);return {...result(value),...(value.error?{isError:true}:{})};}
   catch(error){return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:'Action failed'}]};}
  });
 }
 function query(args:Record<string,unknown>){return new URLSearchParams(Object.entries(args).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])).toString();}
 register('get_account','Read your member profile and available karma.',{},false,()=>call('me'));
 register('get_wallet','Read your karma balances and ledger, 20 transactions per page.',{page,type:z.enum(['seed_grant','campaign_reserve','task_reward','campaign_release','purchase','scan_spend','autofix_spend','spend_refund']).optional()},false,args=>call(`wallet?${query(args)}`));
 register('list_campaigns','List public campaigns, 20 per page. Defaults to open; scope past lists completed/canceled campaigns. Includes your contribution status. site_upvote is Upvote/Likes.',{page,scope:z.enum(['open','past']).optional(),search:z.string().max(150).optional(),task_type:taskType.optional(),platform:platform.optional()},false,args=>call(`campaigns?${query(args)}`));
 register('get_campaign','Inspect a campaign, its instructions, proof requirements and slot counts. Returns a link to open it in the website.',campaignId,false,async args=>({...await call(`campaigns/${args.campaign_id}`),page_url:`${origin}/?view=campaign&id=${encodeURIComponent(args.campaign_id)}`}));
 register('list_my_campaigns','List your campaigns with pending and approved counts, 20 per page.',{page,status:z.enum(['draft','active','paused','completed','canceled']).optional()},false,args=>call(`campaigns/mine?${query(args)}`));
 register('list_my_contributions','List your tasks and contribution history, 20 per page.',{page,status:statuses.optional(),campaign_id:identifier.optional()},false,args=>call(`contributions/mine?${query(args)}`));
 register('list_proofs_to_review','List submissions to campaigns you own, 20 per page. Defaults to pending (submitted).',{page,status:z.enum(['submitted','approved','auto_approved','denied']).default('submitted'),campaign_id:identifier.optional()},false,args=>call(`proofs/review?${query(args)}`));
 register('get_proof','Read a contribution, its campaign brief and all proof. File items include browser download links. Use get_screenshot to view files through MCP.',contributionId,false,async args=>{
  const value=await call(`contributions/${args.contribution_id}`);
  const proof=value.proof as {id:string;kind:string;value:string}[];
  return {...value,proof:proof.map(item=>item.kind==='file'?{...item,value:`${origin}/api/proof-files/${item.id}`,download_url:`${origin}/api/proof-files/${item.id}`} :item),page_url:`${origin}/?view=proof&id=${encodeURIComponent(args.contribution_id)}`};
 });
 server.registerTool('get_screenshot',{description:'View an uploaded proof screenshot as an image. Only your proof, proof on your campaign, or operator access is permitted.',inputSchema:{proof_id:identifier},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async args=>{
  const response=await send(`${origin}/api/proof-files/${args.proof_id}`,{headers:{Authorization:`Bearer ${identity.token}`}});
  if(!response.ok){const value=await response.json() as {error:string};return {isError:true,content:[{type:'text' as const,text:value.error}]};}
  const bytes=new Uint8Array(await response.arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {content:[{type:'image' as const,data:btoa(binary),mimeType:response.headers.get('content-type')||'image/png'}]};
 });
 register('create_campaign_draft','Create an editable draft. Does not reserve karma or publish. User testing requires reward.',campaignFields,true,args=>call('campaigns','POST',args));
 register('open_campaign','Create and publish a new campaign, reserving reward × slots karma. Published terms cannot be edited. If funding fails, returns the created draft ID.',campaignFields,true,async args=>{
  const draft=await call('campaigns','POST',args),id=String(draft.id);
  try{await call(`campaigns/${id}/publish`,'POST');return {id,status:'active',page_url:`${origin}/?view=campaign&id=${id}`};}
  catch(error){return {id,status:'draft',published:false,error:error instanceof Error?error.message:'Publishing failed',page_url:`${origin}/?view=create&id=${id}`};}
 });
 register('publish_campaign','Publish your existing draft and reserve its full karma budget.',campaignId,true,args=>call(`campaigns/${args.campaign_id}/publish`,'POST'));
 register('pause_campaign','Pause your campaign to stop new starts. Existing work remains eligible.',campaignId,true,args=>call(`campaigns/${args.campaign_id}/pause`,'POST'));
 register('resume_campaign','Resume your paused campaign.',campaignId,true,args=>call(`campaigns/${args.campaign_id}/resume`,'POST'));
 register('cancel_campaign','Cancel your campaign and close unsubmitted tasks. Return unused funding; submitted proofs stay funded.',campaignId,true,args=>call(`campaigns/${args.campaign_id}/cancel`,'POST'),true);
 register('start_task','Reserve a campaign slot for 24 hours. You cannot start your own campaign or repeat the same campaign.',campaignId,true,args=>call(`campaigns/${args.campaign_id}/start`,'POST'));
 register('upload_screenshot','Attach a screenshot to your started task before submitting. Base64 PNG/JPEG/WebP only, maximum 5 MB; at most five files.',{...contributionId,filename:z.string().min(1).max(200),mime_type:z.enum(['image/png','image/jpeg','image/webp']),base64:z.string().min(1).max(6990508)},true,async args=>{
  const bytes=decodeScreenshotBase64(args.base64),form=new FormData();
  form.append('file',new File([bytes],args.filename,{type:args.mime_type}));
  return call(`contributions/${args.contribution_id}/files`,'POST',form);
 });
 register('submit_proof','Submit your completed task proof and start the 72-hour review window. Provide text, URL or previously uploaded screenshots. Submission locks proof.',{...contributionId,text:z.string().max(10000).optional(),url:z.string().url().max(2048).optional()},true,args=>call(`contributions/${args.contribution_id}/submit`,'POST',{text:args.text,url:args.url}));
 register('approve_proof','Approve a submitted proof on a campaign you own. Pays the contributor from your reserved karma.',contributionId,true,args=>call(`contributions/${args.contribution_id}/approve`,'POST'));
 register('deny_proof','Deny a submitted proof on your campaign before its 72-hour deadline. Required reason is visible to the contributor; denial prevents payout.',{...contributionId,reason},true,args=>call(`contributions/${args.contribution_id}/deny`,'POST',{reason:args.reason}),true);
 register('report_owner','Report an unfair denial of your own proof with a required reason. Reports can trigger an owner ban; reporting does not pay karma.',{...contributionId,reason},true,args=>call(`contributions/${args.contribution_id}/report`,'POST',{reason:args.reason}),true);
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:8*1024*1024});
 try{
  await server.connect(transport);
  const response=await transport.handleRequest(request);
  // JSON mode completes each request before returning, so no connection state is retained.
  response.headers.set('Cache-Control','no-store');
  return response;
 }finally{await server.close();}
}
