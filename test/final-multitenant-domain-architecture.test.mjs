import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260924090000_final_multitenant_default_subdomains.sql", import.meta.url),
  "utf8"
);
const portal = fs.readFileSync(
  new URL("../src/platform/PlatformOwnerPortal.tsx", import.meta.url),
  "utf8"
);
const controlPlane = fs.readFileSync(
  new URL("../src/platform/PlatformOwnerControlPlane.tsx", import.meta.url),
  "utf8"
);

test("final multi-tenant provisioning creates platform-managed default subdomains when enabled", () => {
  assert.match(migration, /default_subdomains_enabled/);
  assert.match(migration, /v_slug \|\| '\.' \|\| v_default_domain/);
  assert.match(migration, /domain_type,.*default_subdomain/s);
  assert.match(migration, /status,.*verified/s);
  assert.match(migration, /tls_status,.*active/s);
  assert.match(migration, /is_primary/);
});

test("custom domains remain independently supported", () => {
  assert.match(migration, /p_hostname/);
  assert.match(migration, /'custom'/);
  assert.match(migration, /'dns_txt'/);
  assert.match(portal, /Register custom domain/);
});

test("Owner can enable automatic default subdomains from platform settings", () => {
  assert.match(portal, /defaultSubdomainsEnabled/);
  assert.match(portal, /default_subdomains_enabled/);
  assert.match(portal, /Enable automatic institute subdomains/);
});

const recovery = fs.readFileSync(
  new URL("../supabase/functions/password-recovery-request/index.ts", import.meta.url),
  "utf8"
);
const pdfJobs = fs.readFileSync(
  new URL("../supabase/functions/pdf-compression-jobs/index.ts", import.meta.url),
  "utf8"
);

test("admin invitations do not fall back to the retired GitHub Pages host", () => {\n  const invite = fs.readFileSync(\n    new URL("../supabase/functions/platform-invite-admin/index.ts", import.meta.url),\n    "utf8"\n  );\n  assert.match(invite, /MAHIN_ADMIN_INVITE_REDIRECT/);\n  assert.match(invite, /PUBLIC_APP_ORIGIN/);\n  assert.match(invite, /default_app_domain/);\n  assert.doesNotMatch(invite, /mahin98250\\.github\\.io\\/Mahin/);\n});\n\ntest("runtime recovery redirects are tenant-aware and reject legacy host coupling", () => {
  assert.match(recovery, /PUBLIC_APP_ORIGIN/);
  assert.match(recovery, /institute_domains/);
  assert.match(recovery, /tls_status/);
  assert.match(recovery, /resetPasswordForEmail\(email, \{ redirectTo: recoveryOrigin \+ "\/" \}\)/);
  assert.doesNotMatch(recovery, /mahin\.vercel\.app/);
});

test("PDF compression worker uses explicit infrastructure configuration", () => {
  assert.match(pdfJobs, /PDF_COMPRESSION_RASTER_WORKER_URL/);
  assert.match(pdfJobs, /structural fallback will be used/);
  assert.doesNotMatch(pdfJobs, /mahin\.vercel\.app/);
});


test("platform domain lifecycle controls remain in the dedicated platform operations surface", () => {
  assert.doesNotMatch(controlPlane, /register_institute_domain/);
  assert.doesNotMatch(controlPlane, /platform_record_domain_dns_verified/);
  assert.doesNotMatch(controlPlane, /platform_set_domain_tls_status/);
  assert.doesNotMatch(controlPlane, /platform_set_primary_domain/);
  assert.doesNotMatch(controlPlane, /platform_disable_domain/);
  assert.match(portal, /register_institute_domain/);
  assert.match(portal, /platform_record_domain_dns_verified/);
  assert.match(portal, /platform_set_domain_tls_status/);
  assert.match(portal, /platform_set_primary_domain/);
  assert.match(portal, /platform_disable_domain/);
});
