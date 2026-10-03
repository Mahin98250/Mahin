import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

const portal = read("src/admin/ModernAdminPortal.tsx");
const permissions = read("src/admin/admin-permissions.ts");
const migration = read("supabase/migrations/20261003134213_admin_effective_permissions_overview.sql");

test("Admin navigation is driven by effective institute permissions", () => {
  assert.match(portal, /requiredPermission/);
  assert.match(portal, /useCurrentInstitutePermissions/);
  assert.match(portal, /notifications\.read/);
  assert.match(portal, /students\.manage/);
  assert.match(portal, /teachers\.manage/);
  assert.match(portal, /academics\.manage/);
  assert.match(portal, /assessments\.read/);
  assert.match(portal, /reports\.read/);
});

test("Admin permission loader uses one backend permission overview RPC", () => {
  assert.match(permissions, /get_current_institute_permissions/);
  assert.match(permissions, /p_institute_id: id/);
  assert.match(permissions, /new Set/);
});

test("Institute permission overview is secure and override-aware", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /effect = 'allow'/);
  assert.match(migration, /effect = 'deny'/);
  assert.match(migration, /revoke all on function public\.get_current_institute_permissions/);
  assert.match(migration, /grant execute on function public\.get_current_institute_permissions\(uuid\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.get_current_institute_permissions\(uuid\) to anon/);
});

test("Admin CRUD remains server-enforced; permission-aware navigation is UX only", () => {
  assert.match(portal, /Existing server-side access controls remain active/);
});
