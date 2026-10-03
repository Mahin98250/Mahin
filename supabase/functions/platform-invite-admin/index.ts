import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return json({ok:true});
  try{
    if(req.method!=="POST") return json({error:"Method not allowed"},405);
    const authorization=req.headers.get("Authorization");
    if(!authorization) return json({error:"Missing authorization"},401);
    const url=Deno.env.get("SUPABASE_URL")||"";
    const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
    if(!url||!anon||!service) return json({error:"Supabase environment is not configured"},500);

    const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
    const {data:allowed,error:gateError}=await caller.rpc("platform_owner_access_ok");
    if(gateError) return json({error:"Unable to verify platform owner access."},500);
    if(!allowed) return json({error:"Platform owner MFA verification required."},403);

    const body=await req.json();
    const instituteId=String(body.instituteId||"").trim();
    const email=String(body.email||"").trim().toLowerCase();
    const roleKey=String(body.roleKey||"institute_admin").trim();
    if(!instituteId||!email) return json({error:"Institute and email are required."},400);

    const {data:invId,error:prepareError}=await caller.rpc("platform_create_admin_invitation",{p_institute_id:instituteId,p_email:email,p_role_key:roleKey});
    if(prepareError) return json({error:prepareError.message},400);

    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
    const configuredRedirect=String(Deno.env.get("MAHIN_ADMIN_INVITE_REDIRECT")||Deno.env.get("PUBLIC_APP_ORIGIN")||"").trim();
    let redirectTo="";
    if(configuredRedirect){
      try{
        const base=new URL(configuredRedirect);
        redirectTo=new URL("/auth?mode=admin-invite",base.origin).toString();
      }catch{
        return json({error:"Admin invitation redirect is not configured correctly."},500);
      }
    }else{
      const {data:platformSettings,error:settingsError}=await admin.from("platform_settings").select("default_app_domain").eq("id",1).maybeSingle();
      const defaultHost=String(platformSettings?.default_app_domain||"").trim().replace(/^https?:\\/\\//,"").replace(/\\/$/,"");
      if(settingsError||!defaultHost) return json({error:"Admin invitation redirect is not configured."},500);
      redirectTo=`https://${defaultHost}/auth?mode=admin-invite`;
    }
    const {data:invite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{
      data:{mahin_invitation_id:invId,mahin_institute_id:instituteId,mahin_role:roleKey},
      redirectTo
    });
    if(inviteError){
      await caller.rpc("platform_revoke_admin_invitation",{p_invitation_id:invId});
      return json({error:inviteError.message},502);
    }

    const {data:finalized,error:finalizeError}=await caller.rpc("platform_finalize_admin_invitation",{p_invitation_id:invId,p_auth_id:invite.user.id});
    if(finalizeError){
      await admin.auth.admin.deleteUser(invite.user.id).catch(()=>{});
      await caller.rpc("platform_revoke_admin_invitation",{p_invitation_id:invId});
      return json({error:finalizeError.message},502);
    }
    return json({invitationId:invId,authId:invite.user.id,email,roleKey,status:finalized?.status||"pending"});
  }catch(error){
    return json({error:error instanceof Error?error.message:"Invitation failed"},500);
  }
});