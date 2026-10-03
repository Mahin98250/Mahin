import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";
import postgres from "npm:postgres@3";

const PROJECT_REF = "efnxjfzyqbdulpjhffsm";
const REGION = "ap-northeast-1";
const EXPECTED_REPOSITORY = "Mahin98250/Mahin";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_WORKFLOW_REF = `${EXPECTED_REPOSITORY}/.github/workflows/supabase-complete-backup-final.yml@${EXPECTED_REF}`;
const OIDC_AUDIENCE = "mahin-supabase-backup";
const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const DEFAULT_POOLER_HOST = `aws-1-${REGION}.pooler.supabase.com`;

const githubJWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const supabaseUrl = Deno.env.get("SUPABASE_URL") || `https://${PROJECT_REF}.supabase.co`;

function getSupabaseAdminKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (encoded) {
    try {
      const keys = JSON.parse(encoded);
      const defaultKey = keys?.default;
      if (typeof defaultKey === "string" && defaultKey.length > 0) return defaultKey;
    } catch {
      // Ignore malformed optional secret payload and report a single clear error below.
    }
  }
  throw new Error("Supabase privileged key is unavailable to backup broker");
}

const serviceKey = getSupabaseAdminKey();
const sourceDbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!sourceDbUrl) throw new Error("Supabase DB URL is unavailable to backup broker");

const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function responseJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & Record<string, unknown>;
    const fields = ["message", "code", "errno", "syscall", "hostname", "port", "address", "severity", "detail", "hint"];
    const parts = fields
      .filter((field) => details[field] !== undefined && details[field] !== null)
      .map((field) => `${field}=${String(details[field])}`);
    return parts.length > 0 ? parts.join("; ") : error.message;
  }
  if (typeof error === "object" && error !== null) {
    try {
      const safe = JSON.parse(JSON.stringify(error, (key, value) =>
        ["password", "url", "connectionString"].includes(key) ? "[redacted]" : value));
      return JSON.stringify(safe);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

function bearerToken(req: Request) {
  const value = req.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function authorizeGitHub(req: Request) {
  const token = bearerToken(req);
  if (!token) throw new Error("missing GitHub OIDC bearer token");
  const { payload } = await jwtVerify(token, githubJWKS, {
    issuer: GITHUB_ISSUER,
    audience: OIDC_AUDIENCE,
    algorithms: ["RS256"],
  });
  if (String(payload.repository || "") !== EXPECTED_REPOSITORY) throw new Error("unauthorized repository");
  if (String(payload.repository_owner || "") !== "Mahin98250") throw new Error("unauthorized repository owner");
  if (String(payload.ref || "") !== EXPECTED_REF) throw new Error("unauthorized ref");
  const workflowRef = String(payload.workflow_ref || "");
  const jobWorkflowRef = String(payload.job_workflow_ref || "");
  if (workflowRef !== EXPECTED_WORKFLOW_REF && jobWorkflowRef !== EXPECTED_WORKFLOW_REF) throw new Error("unauthorized workflow");
}

function parseConnectionString(input: string) {
  const parsed = new URL(input);
  return {
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "") || "postgres"),
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
  };
}

async function verifyDatabaseUrl(url: string) {
  const client = postgres(url, {
    max: 1,
    idle_timeout: 3,
    connect_timeout: 10,
    ssl: "require",
    prepare: false,
  });
  try {
    const rows = await client`select current_database() as database, current_user as user, current_setting('server_version') as version`;
    return rows[0];
  } finally {
    await client.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function getVerifiedSessionPoolerUrl() {
  const source = parseConnectionString(sourceDbUrl!);
  const username = `postgres.${PROJECT_REF}`;
  const database = source.database || "postgres";
  const configuredHost = Deno.env.get("SUPABASE_SESSION_POOLER_HOST")?.trim();
  const hosts = [
    configuredHost,
    DEFAULT_POOLER_HOST,
    `aws-${REGION}.pooler.supabase.com`,
    `aws-0-${REGION}.pooler.supabase.com`,
  ].filter((host, index, list): host is string => Boolean(host) && list.indexOf(host) === index);

  if (source.port === 5432 && source.hostname.endsWith("pooler.supabase.com")) {
    return { url: sourceDbUrl, verification: await verifyDatabaseUrl(sourceDbUrl!) };
  }

  const failures: string[] = [];
  for (const host of hosts) {
    const candidate = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(source.password)}@${host}:5432/${encodeURIComponent(database)}`;
    try {
      return { url: candidate, verification: await verifyDatabaseUrl(candidate) };
    } catch (error) {
      failures.push(`${host}: ${formatError(error)}`);
    }
  }
  throw new Error(`no working Supabase Session Pooler endpoint; ${failures.join(" | ")}`);
}

type ListedStorageItem = {
  name: string;
  id: string | null;
  metadata: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
};

function joinStoragePath(prefix: string, name: string) {
  return prefix ? `${prefix}/${name}` : name;
}

async function listStorageFiles(bucketId: string) {
  const files: ListedStorageItem[] = [];
  const queue: string[] = [""];
  const limit = 1000;

  while (queue.length > 0) {
    const prefix = queue.shift()!;
    let offset = 0;

    while (true) {
      const result = await admin.storage.from(bucketId).list(prefix, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (result.error) throw result.error;

      const page = (result.data || []) as ListedStorageItem[];
      for (const item of page) {
        const fullPath = joinStoragePath(prefix, item.name);
        if (item.id === null) {
          queue.push(fullPath);
        } else {
          files.push({
            ...item,
            name: fullPath,
          });
        }
      }

      if (page.length < limit) break;
      offset += limit;
    }
  }

  return files;
}

async function collectStorage() {
  const bucketsResult = await admin.storage.listBuckets();
  if (bucketsResult.error) throw bucketsResult.error;
  const buckets = bucketsResult.data || [];
  const objects: Array<Record<string, unknown>> = [];

  for (const bucket of buckets) {
    const files = await listStorageFiles(bucket.id);
    for (const file of files) {
      const signed = await admin.storage.from(bucket.id).createSignedUrl(file.name, 3600);
      if (signed.error || !signed.data?.signedUrl) {
        throw signed.error || new Error(`failed to create signed URL for ${bucket.id}/${file.name}`);
      }
      objects.push({
        bucket: bucket.id,
        name: file.name,
        id: file.id,
        metadata: file.metadata,
        created_at: file.created_at ?? null,
        updated_at: file.updated_at ?? null,
        last_accessed_at: file.last_accessed_at ?? null,
        signed_url: signed.data.signedUrl,
      });
    }
  }

  return { buckets, objects };
}

async function collectAuthUsers() {
  const users: unknown[] = [];
  let page = 1;
  while (true) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    const batch = result.data.users || [];
    users.push(...batch.map((user) => ({
      id: user.id,
      aud: user.aud,
      role: user.role,
      email: user.email,
      phone: user.phone,
      created_at: user.created_at,
      updated_at: user.updated_at,
      email_confirmed_at: user.email_confirmed_at,
      phone_confirmed_at: user.phone_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
      identities: user.identities,
      is_anonymous: user.is_anonymous,
    })));
    if (batch.length < 1000) break;
    page += 1;
  }
  return users;
}

async function requestMode(req: Request) {
  try {
    const body = await req.json();
    if (body?.mode === "database" || body?.mode === "storage") return body.mode;
  } catch {
    // Default to the complete backup mode when the optional JSON body is absent or malformed.
  }
  return "complete" as const;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responseJson({ error: "POST required" }, 405);
  try {
    await authorizeGitHub(req);
    const mode = await requestMode(req);

    if (mode === "database") {
      const db = await getVerifiedSessionPoolerUrl();
      return responseJson({ ok: true, project_ref: PROJECT_REF, db, issued_at: new Date().toISOString() });
    }

    const storage = await collectStorage();
    const authUsers = await collectAuthUsers();
    if (mode === "storage") {
      return responseJson({ ok: true, project_ref: PROJECT_REF, storage, auth_users: authUsers, issued_at: new Date().toISOString() });
    }

    const db = await getVerifiedSessionPoolerUrl();
    return responseJson({ ok: true, project_ref: PROJECT_REF, db, storage, auth_users: authUsers, issued_at: new Date().toISOString() });
  } catch (error) {
    const message = formatError(error);
    console.error("backup broker failure", message);
    return responseJson({ error: message }, 500);
  }
});
