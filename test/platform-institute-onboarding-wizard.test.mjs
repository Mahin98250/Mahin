import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

const migration = read("supabase/migrations/20261003143626_institute_onboarding_configuration.sql");
const wizard = read("src/platform/InstituteOnboardingWizard.tsx");
const controlPlane = read("src/platform/PlatformOwnerControlPlane.tsx");

test("institute onboarding stores the full tenant profile and branding", () => {
  for (const field of [
    "description",
    "institute_type",
    "phone",
    "email",
    "website_url",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "cover_image_url",
    "logo_alt_text",
  ]) assert.ok(migration.includes("add column if not exists " + field), field);
  assert.match(migration, /create table if not exists public\.institute_custom_feature_requests/);
});

test("institute onboarding is atomic, owner-protected, and feature-aware", () => {
  assert.match(migration, /create or replace function public\.platform_onboard_institute/);
  assert.match(migration, /platform_owner_access_ok\(\)/);
  assert.match(migration, /perform public\.seed_institute_defaults\(v_id\)/);
  assert.match(migration, /institute_feature_entitlements/);
  assert.match(migration, /academic_years/);
  assert.match(migration, /depends_on/);
  assert.match(migration, /institute\.onboarded/);
  assert.match(migration, /revoke all on function public\.platform_onboard_institute\(/);
  assert.match(migration, /grant execute on function public\.platform_onboard_institute\(/);
});

test("institute branding assets use the dedicated Storage bucket and platform-owner policies", () => {
  assert.match(migration, /institute-assets/);
  assert.match(migration, /storage\.objects/);
  assert.match(migration, /storage\.foldername\(name\)/);
  assert.match(wizard, /institute-assets/);
  assert.match(wizard, /\.storage\.from\("institute-assets"\)/);
});

test("owner onboarding is a true multi-panel wizard", () => {
  for (const panel of [
    "Institute identity",
    "Contact & location",
    "Branding",
    "Academic setup",
    "Features",
    "Portal access",
    "Custom feature",
    "Review & create",
  ]) assert.ok(wizard.includes(panel), panel);
  assert.match(wizard, /You can jump between panels at any time/);
  assert.match(wizard, /platform_onboard_institute/);
});

test("feature selection manages dependencies and custom requests", () => {
  assert.match(wizard, /Turning on a feature also turns on its dependencies/);
  assert.match(wizard, /p_enabled_features: Array\.from\(enabledFeatures\)/);
  assert.match(wizard, /p_custom_request_title/);
  assert.match(wizard, /p_custom_request_description/);
  assert.match(wizard, /Custom requests go into the platform delivery queue/);
});

test("owner control plane uses the new onboarding wizard instead of the small legacy form", () => {
  assert.match(controlPlane, /InstituteOnboardingWizard/);
  assert.doesNotMatch(controlPlane, /const createInstitute = async/);
  assert.doesNotMatch(controlPlane, /platform_provision_institute/);
  assert.doesNotMatch(controlPlane, /createHostname/);
});
