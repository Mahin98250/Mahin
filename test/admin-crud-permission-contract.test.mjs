import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queries = readFileSync("src/lg/data/queries.js", "utf8");
const mutations = readFileSync("src/lg/data/mutations.js", "utf8");
const migration = readFileSync("supabase/migrations/20260921175000_admin_crud_permission_guardrails.sql", "utf8");
const directAdminFiles = [
  "src/admin/HomeworkPage.tsx",
  "src/admin/MaterialsDrive.tsx",
  "src/admin/MaterialsDriveV2.tsx",
  "src/admin/batches/BatchesTimetablePage.tsx",
  "src/admin/batches/TeacherBatchAssignmentPage.tsx",
  "src/admin/AdminAnalytics.tsx",
  "src/admin/ModernAdminDashboard.tsx",
].map(path => [path, readFileSync(path, "utf8")]);

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
  ["parent_student_links", "guardians.read"],
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
  ["parent_student_links", "guardians.manage"],
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
assert.match(migration, /public\.users is a legacy\/global compatibility table/);
assert.doesNotMatch(migration, /array\['users','people\.(read|manage)'\]/);
assert.match(migration, /Admin 10X migration requires public\.%\.institute_id/);

assert.match(migration, /admin_permission_materials_storage_insert/);
assert.match(migration, /admin_permission_materials_storage_delete/);
assert.match(migration, /admin_permission_homework_storage_insert/);
assert.match(migration, /admin_permission_homework_storage_delete/);
assert.match(migration, /user_has_institute_permission\\(split_part\\(name/);
assert.match(migration, /user_has_institute_permission\\(h\\.institute_id,'homework\\.read'/);
assert.match(migration, /user_has_institute_permission\\(m\\.institute_id,'materials\\.read'/);

for (const [path, source] of directAdminFiles) {
  assert.match(source, /hasInstitutePermission/, `${path} must use canonical tenant permission checks`);
}
assert.match(directAdminFiles.find(([path]) => path.endsWith("HomeworkPage.tsx"))[1], /homework\\.manage/);
assert.match(directAdminFiles.find(([path]) => path.endsWith("MaterialsDriveV2.tsx"))[1], /materials\\.manage/);
assert.match(directAdminFiles.find(([path]) => path.endsWith("BatchesTimetablePage.tsx"))[1], /timetable\\.manage/);
assert.match(directAdminFiles.find(([path]) => path.endsWith("TeacherBatchAssignmentPage.tsx"))[1], /academics\\.manage/);
assert.match(directAdminFiles.find(([path]) => path.endsWith("AdminAnalytics.tsx"))[1], /people\\.read/);
assert.match(directAdminFiles.find(([path]) => path.endsWith("HomeworkPage.tsx"))[1], /institute\\/\\$\\{instituteId\\}\\/homework/);
assert.match(directAdminFiles.find(([path]) => path.endsWith("MaterialsDriveV2.tsx"))[1], /institute\\/\\$\\{instituteId\\}\\/materials/);
assert.match(directAdminFiles.find(([path]) => path.endsWith("MaterialsDrive.tsx"))[1], /institute\\/\\$\\{instituteId\\}\\/materials/);

console.log("Admin CRUD/read permission contract passed.");
