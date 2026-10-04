import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queries = readFileSync("src/lg/data/queries.js", "utf8");
const mutations = readFileSync("src/lg/data/mutations.js", "utf8");
const migration = readFileSync("supabase/migrations/20260921175000_admin_crud_permission_guardrails.sql", "utf8");

const readPermissions = [
  ["students", "students.read"],
  ["teachers", "teachers.read"],
  ["batches", "academics.read"],
  ["attendance", "attendance.read"],
  ["homework", "homework.read"],
  ["materials", "materials.read"],
  ["announcements", "announcements.read"],
  ["fees", "fees.read"],
  ["tests", "assessments.read"],
  ["test_results", "assessments.read"],
  ["timetable_entries", "timetable.read"],
];

for (const [table, permission] of readPermissions) {
  assert.match(queries, new RegExp(`["']${table}["'],["']${permission.replace(".", "\\.")}["']`));
}

const writePermissions = [
  ["students", "students.manage"],
  ["teachers", "teachers.manage"],
  ["batches", "academics.manage"],
  ["attendance", "attendance.manage"],
  ["homework", "homework.manage"],
  ["materials", "materials.manage"],
  ["announcements", "announcements.manage"],
  ["fees", "fees.manage"],
  ["tests", "assessments.manage"],
  ["test_results", "assessments.manage"],
  ["timetable_entries", "timetable.manage"],
];

for (const [table, permission] of writePermissions) {
  assert.match(queries, new RegExp(`["']${table}["'],["']${permission.replace(".", "\\.")}["']`));
}

assert.match(queries, /export async function assertAdminTablePermission/);
assert.match(queries, /await assertAdminTablePermission\(t,"read"\)/);
assert.match(mutations, /await assertAdminTablePermission\(t,"write"\)/);
assert.match(migration, /as restrictive for select to authenticated/);
assert.match(migration, /as restrictive for insert to authenticated/);
assert.match(migration, /as restrictive for update to authenticated/);
assert.match(migration, /as restrictive for delete to authenticated/);
assert.match(migration, /public\.user_has_institute_permission\(institute_id/);
assert.match(migration, /public\.is_platform_member\(\)/);

console.log("Admin CRUD/read permission contract passed.");

const directAdminFiles = [
  "src/admin/HomeworkPage.tsx",
  "src/admin/MaterialsDrive.tsx",
  "src/admin/MaterialsDriveV2.tsx",
  "src/admin/batches/BatchesTimetablePage.tsx",
  "src/admin/batches/TeacherBatchAssignmentPage.tsx",
  "src/admin/AdminAnalytics.tsx",
  "src/admin/ModernAdminDashboard.tsx",
].map(path => [path, readFileSync(path, "utf8")]);

assert.doesNotMatch(migration, /array\['users','/);
assert.match(migration, /Fail closed if a mapped table ever loses its tenant boundary/);
for (const [path, source] of directAdminFiles) {
  assert.match(source, /hasInstitutePermission/, `Expected direct admin permission guard in ${path}`);
}
