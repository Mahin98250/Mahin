import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("teacher records reuse shared admin auth and ID helpers", () => {
  const page = read("src/admin/records/TeacherRecordsPage.tsx");
  const auth = read("src/admin/records/AdminRecordsAuth.ts");

  assert.match(page, /from ["']\.\/AdminRecordsAuth["']/);
  assert.match(page, /provision\("teacher"/);
  assert.match(page, /nextId\("teachers"\)/);
  assert.doesNotMatch(page, /supabase\.functions\.invoke\(\s*["']admin-provision-user["']/);
  assert.doesNotMatch(page, /async function nextTeacherId/);
  assert.match(auth, /export async function provision/);
  assert.match(auth, /export async function nextId/);
});
