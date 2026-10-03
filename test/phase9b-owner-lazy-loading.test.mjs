import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

const controlPlane = read("src/platform/PlatformOwnerControlPlane.tsx");
const onboardingWizard = read("src/platform/InstituteOnboardingWizard.tsx");
const client = read("src/platform/platform-tenant-data.ts");
const migration = read("supabase/migrations/20260923020000_phase9b_owner_lazy_tenant_detail.sql");
const overviewMigration = read("supabase/migrations/20260924100000_owner_institute_readonly_overview.sql");
const route = read("src/routes/owner.tsx");

test("Phase 9B routes Owner through a bounded control plane", () => {
  assert.match(route, /PlatformOwnerControlPlane/);
  assert.match(controlPlane, /listPlatformInstitutes/);
  assert.match(controlPlane, /getPlatformInstituteStatusCounts/);
  assert.match(controlPlane, /limit: 50/);
});

test("Owner directory does not materialize institute collections through direct browser reads", () => {
  assert.doesNotMatch(controlPlane, /\.from\(["']institutes["']\)/);
  assert.doesNotMatch(controlPlane, /\.from\(["']institute_domains["']\)/);
  assert.doesNotMatch(controlPlane, /\.from\(["']audit_logs["']\)/);
  assert.match(client, /platform_list_institutes/);
  assert.match(client, /platform_institute_status_counts/);
});

test("Owner onboarding exposes the real multi-panel institute creation flow", () => {
  assert.match(controlPlane, /Create institute/);
  assert.match(controlPlane, /InstituteOnboardingWizard/);
  assert.match(onboardingWizard, /platform_onboard_institute/);
  assert.match(onboardingWizard, /Custom domain/);
  assert.match(onboardingWizard, /Review & create/);
  assert.doesNotMatch(controlPlane, /provisionTimezone|provisionLocale/);
});

test("Institute view is read-only health monitoring", () => {
  assert.match(controlPlane, /getPlatformInstituteOverview/);
  assert.match(controlPlane, /openOverview/);
  assert.match(controlPlane, /READ-ONLY INSTITUTE HEALTH/);
  assert.doesNotMatch(controlPlane, /changeInstituteStatus|platform_set_institute_status/);
  assert.doesNotMatch(controlPlane, /Open full platform operations/);
  assert.doesNotMatch(controlPlane, /PlatformOwnerPortal/);
});

test("Institute overview exposes only aggregate health metrics", () => {
  assert.match(client, /platform_get_institute_overview/);
  assert.match(client, /admin_portals/);
  assert.match(client, /study_materials_bytes/);
  assert.match(client, /homework_bytes/);
});

test("Tenant detail RPC remains owner-gated and excludes verification secrets", () => {
  assert.match(migration, /platform_owner_access_ok\(\)/);
  assert.match(migration, /platform_get_institute_detail/);
  assert.match(migration, /revoke all on function public\.platform_get_institute_detail/);
  assert.doesNotMatch(migration, /'verification_token'/);
});

test("Read-only institute overview RPC is owner-gated and mutation-free", () => {
  assert.match(overviewMigration, /platform_owner_access_ok\(\)/);
  assert.match(overviewMigration, /platform_get_institute_overview/);
  assert.match(overviewMigration, /revoke all on function public\.platform_get_institute_overview/);
  assert.match(overviewMigration, /admin_portals/);
  assert.match(overviewMigration, /study_materials_bytes/);
  assert.doesNotMatch(overviewMigration, /update public\.institute_memberships|delete from public\.institute_memberships|insert into public\.institute_memberships/);
});
