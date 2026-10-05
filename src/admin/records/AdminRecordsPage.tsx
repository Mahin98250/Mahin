import { useCallback, useEffect, useMemo, useState } from "react";
import { C, addR, delR, gdb, updR } from "@/lg/data";
import {
  CLASSES,
  SECTIONS,
  SUBJECTS,
  card,
  type Row,
  type Kind,
  type ProvisionRole,
} from "./AdminRecordsConstants";
import {
  ensureAdminSession,
  provision,
  normalizePhone,
  validatePassword,
  authRowId,
  nextId,
} from "./AdminRecordsAuth";
import { Input, Select, MultiSelect } from "./AdminRecordsFields";

export default function AdminRecordsPage({ kind }: { kind: Kind }) {
  const isStudent = kind === "students";
  const [rows, setRows] = useState<Row[]>([]); const [query, setQuery] = useState(""); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [editing, setEditing] = useState<Row | null>(null); const [modal, setModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const [credentials, setCredentials] = useState<{ role: string; login: string; password: string; parentLogin?: string; parentPassword?: string } | null>(null);
  const [form, setForm] = useState({ name: "", sid: "", tid: "", cls: "", sec: "", enroll: new Date().toISOString().slice(0, 10), status: "active", password: "", parentPassword: "", parentName: "", parentPhone: "", phone: "" });
  const [teacherSubjects, setTeacherSubjects] = useState<string[]>([]); const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const setField = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const load = useCallback(async () => { setLoading(true); setError(""); try { setRows((await gdb(kind)) as Row[]); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load records."); } finally { setLoading(false); } }, [kind]);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))) : rows; }, [rows, query]);

  const openNew = async () => {
    setEditing(null); setError(""); setSuccess(""); setCredentials(null); setTeacherSubjects([]); setTeacherClasses([]);
    try {
      await ensureAdminSession();
      if (isStudent) setForm({ name: "", sid: await nextId("students"), tid: "", cls: "", sec: "", enroll: new Date().toISOString().slice(0, 10), status: "active", password: "", parentPassword: "", parentName: "", parentPhone: "", phone: "" });
      else setForm({ name: "", sid: "", tid: await nextId("teachers"), cls: "", sec: "", enroll: "", status: "active", password: "", parentPassword: "", parentName: "", parentPhone: "", phone: "" });
      setModal(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to prepare the form."); }
  };

  const openEdit = (row: Row) => {
    setEditing(row); setError(""); setSuccess(""); setCredentials(null); setModal(true);
    if (isStudent) setForm({ name: String(row.name ?? ""), sid: String(row.sid ?? ""), tid: "", cls: String(row.cls ?? ""), sec: String(row.sec ?? ""), enroll: String(row.enroll ?? ""), status: String(row.status ?? "active"), password: "", parentPassword: "", parentName: String(row.parentname ?? row.parentName ?? ""), parentPhone: String(row.parentphone ?? row.parentPhone ?? ""), phone: "" });
    else setForm({ name: String(row.name ?? ""), sid: "", tid: String(row.tid ?? ""), cls: "", sec: "", enroll: "", status: String(row.status ?? "active"), password: "", parentPassword: "", parentName: "", parentPhone: "", phone: String(row.phone ?? "") });
    if (!isStudent) { setTeacherSubjects(String(row.subject ?? "").split(",").map((x) => x.trim()).filter(Boolean)); setTeacherClasses(Array.isArray(row.classes) ? row.classes.map(String) : String(row.classes ?? "").split(",").map((x) => x.trim()).filter(Boolean)); }
  };
  const close = () => { if (saving) return; setModal(false); setEditing(null); setError(""); };

  const save = async () => {
    if (!form.name.trim()) { setError("Full Name is required."); return; }
    setSaving(true); setError(""); setSuccess(""); setCredentials(null);
    try {
      await ensureAdminSession();
      const users = editing ? (await gdb("users")) as Row[] : [];
      if (editing) {
        if (isStudent) {
          const parentPhone = normalizePhone(form.parentPhone);
          if (!form.cls || !form.sec || !form.parentName.trim() || !parentPhone) throw new Error("Fill the student's Class, Section, Parent Name and Parent Phone.");
          if (form.password) validatePassword(form.password, "Student password");
          const su = users.find((u) => String(u.ref) === String(editing.id) && u.role === "student"); const pu = users.find((u) => String(u.ref) === String(editing.id) && u.role === "parent");
          const patch = { name: form.name.trim(), sid: form.sid.trim(), cls: form.cls, sec: form.sec, parentname: form.parentName.trim(), parentphone: parentPhone, enroll: form.enroll, status: form.status };
          await updR("students", editing.id, patch);
          const sa = await provision("student", patch.sid, patch.name, String(editing.id), "update", su?.auth_id ? String(su.auth_id) : null, form.password || undefined);
          const pa = await provision("parent", parentPhone, patch.parentname, String(editing.id), "update", pu?.auth_id ? String(pu.auth_id) : null, form.parentPassword || undefined);
          if (sa.authId) { const p = { name: patch.name, phone: patch.sid, email: sa.email, status: patch.status, auth_id: sa.authId }; if (su) await updR("users", su.id, p); else await addR("users", { id: authRowId(sa.authId), ...p, role: "student", ref: editing.id }); }
          if (pa.authId) { const p = { name: patch.parentname, phone: parentPhone, email: pa.email, status: patch.status, auth_id: pa.authId }; if (pu) await updR("users", pu.id, p); else await addR("users", { id: authRowId(pa.authId), ...p, role: "parent", ref: editing.id }); await updR("students", editing.id, { parent: pa.authId }); }
          setSuccess("Student and linked login accounts updated successfully.");
        } else {
          const phone = normalizePhone(form.phone);
          if (!phone || !teacherSubjects.length || !teacherClasses.length) throw new Error("Fill Name and Phone, then choose at least one Subject and one Class.");
          if (form.password) validatePassword(form.password, "Teacher password");
          const tu = users.find((u) => String(u.ref) === String(editing.id) && u.role === "teacher");
          const patch = { name: form.name.trim(), tid: form.tid.trim(), subject: teacherSubjects.join(", "), phone, status: form.status, classes: teacherClasses };
          await updR("teachers", editing.id, patch);
          const auth = await provision("teacher", phone, patch.name, String(editing.id), "update", tu?.auth_id ? String(tu.auth_id) : null, form.password || undefined);
          if (auth.authId) { const p = { name: patch.name, phone, email: auth.email, status: patch.status, auth_id: auth.authId }; if (tu) await updR("users", tu.id, p); else await addR("users", { id: authRowId(auth.authId), ...p, role: "teacher", ref: editing.id }); }
          setSuccess("Teacher and linked login account updated successfully.");
        }
      } else if (isStudent) {
        const parentPhone = normalizePhone(form.parentPhone);
        if (!form.cls || !form.sec || !form.parentName.trim() || !parentPhone) throw new Error("Fill the student's Class, Section, Parent Name and Parent Phone.");
        const password = form.password; const parentPassword = form.parentPassword;
        validatePassword(password, "Student password"); validatePassword(parentPassword, "Parent password");
        const student = await addR("students", { id: `s-${Date.now()}`, name: form.name.trim(), sid: form.sid.trim(), cls: form.cls, sec: form.sec, parentname: form.parentName.trim(), parentphone: parentPhone, enroll: form.enroll, status: "active" });
        const created: Array<{ role: ProvisionRole; authId?: string; login: string; name: string; ref: string }> = [];
        try {
          const sa = await provision("student", form.sid.trim(), form.name.trim(), String(student.id), "create", null, password);
          if (!sa.authId) throw new Error("Student authentication account was not returned by Supabase.");
          created.push({ role: "student", authId: sa.authId, login: form.sid.trim(), name: form.name.trim(), ref: String(student.id) });
          const pa = await provision("parent", parentPhone, form.parentName.trim(), String(student.id), "create", null, parentPassword);
          if (!pa.authId) throw new Error("Parent authentication account was not returned by Supabase.");
          created.push({ role: "parent", authId: pa.authId, login: parentPhone, name: form.parentName.trim(), ref: String(student.id) });
          await updR("students", student.id, { parent: pa.authId });
          await addR("users", { id: authRowId(sa.authId), name: form.name.trim(), phone: form.sid.trim(), email: sa.email, role: "student", ref: student.id, status: "active", auth_id: sa.authId });
          await addR("users", { id: authRowId(pa.authId), name: form.parentName.trim(), phone: parentPhone, email: pa.email, role: "parent", ref: student.id, status: "active", auth_id: pa.authId });
          setCredentials({ role: "Student", login: form.sid.trim(), password, parentLogin: parentPhone, parentPassword });
          setSuccess(`Student ${form.name.trim()} created successfully.`);
        } catch (e) {
          for (const item of created.reverse()) if (item.authId) { try { await provision(item.role, item.login, item.name, item.ref, "delete", item.authId); } catch { /* best effort */ } }
          try { await delR("students", student.id); } catch { /* best effort */ }
          throw new Error(`Student account creation failed: ${e instanceof Error ? e.message : "Unknown provisioning error"}`);
        }
      } else {
        const phone = normalizePhone(form.phone);
        if (!phone || !teacherSubjects.length || !teacherClasses.length) throw new Error("Fill Name and Phone, then choose at least one Subject and one Class.");
        const password = form.password; validatePassword(password, "Teacher password");
        const teacher = await addR("teachers", { id: `t-${Date.now()}`, name: form.name.trim(), tid: form.tid.trim(), subject: teacherSubjects.join(", "), phone, classes: teacherClasses, status: "active" });
        try {
          const auth = await provision("teacher", phone, form.name.trim(), String(teacher.id), "create", null, password);
          if (!auth.authId) throw new Error("Authentication account was not returned by Supabase.");
          await addR("users", { id: authRowId(auth.authId), name: form.name.trim(), phone, email: auth.email, role: "teacher", ref: teacher.id, status: "active", auth_id: auth.authId });
          setCredentials({ role: "Teacher", login: phone, password }); setSuccess(`Teacher ${form.name.trim()} created successfully.`);
        } catch (e) { try { await delR("teachers", teacher.id); } catch { /* best effort */ } throw e; }
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save record. Check the details above and try again."); }
    finally { setSaving(false); }
  };

  const remove = async (row: Row) => {
    setSaving(true); setError(""); setSuccess("");
    try {
      await ensureAdminSession();
      const users = (await gdb("users")) as Row[];
      const linked = users.filter((u) => String(u.ref) === String(row.id) && (isStudent ? ["student", "parent"].includes(String(u.role)) : String(u.role) === "teacher"));
      for (const user of linked) await provision(String(user.role) as ProvisionRole, String(user.phone || ""), String(user.name || "User"), String(row.id), "delete", user.auth_id ? String(user.auth_id) : null);
      await delR(kind, row.id);
      for (const user of linked) { try { await delR("users", user.id); } catch { /* best effort */ } }
      setSuccess(`${isStudent ? "Student" : "Teacher"} deleted successfully.`); setConfirmDelete(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete record."); }
    finally { setSaving(false); }
  };

  const title = isStudent ? "Students" : "Teachers";
  return <section style={{ display: "grid", gap: 16 }}>
    <div style={{ ...card, padding: 20, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}><div><h2 style={{ margin: 0, color: C.text }}>{title}</h2><p style={{ margin: "5px 0 0", color: C.sub, fontSize: 13 }}>{isStudent ? "Manage students and automatically create Student + Parent login accounts." : "Manage teacher profiles and login accounts."}</p></div><button type="button" onClick={() => void openNew()} disabled={loading || saving} style={{ border: 0, borderRadius: 12, padding: "11px 16px", background: C.accent, color: "#fff", fontWeight: 800, cursor: "pointer", opacity: loading || saving ? .6 : 1 }}>{isStudent ? "+ Add Student" : "+ Add Teacher"}</button></div>
    {error && <div role="alert" style={{ ...card, padding: 14, color: C.red, borderColor: `${C.red}55`, background: `${C.red}08` }}>{error}</div>}
    {success && <div role="status" style={{ ...card, padding: 14, color: C.green, borderColor: `${C.green}55`, background: `${C.green}08` }}>{success}</div>}
    {credentials && <div style={{ ...card, padding: 16, borderColor: `${C.accent}55`, background: `${C.accent}08` }}><strong>New {credentials.role} login credentials</strong><div style={{ marginTop: 7, fontSize: 13 }}>Login: <b>{credentials.login}</b> · Password: <b>{credentials.password}</b>{credentials.parentLogin && <><br />Parent Login: <b>{credentials.parentLogin}</b> · Parent Password: <b>{credentials.parentPassword}</b></>}</div></div>}
    <div style={{ ...card, padding: 16 }}><Input label="Search" value={query} onChange={setQuery} placeholder={`Search ${title.toLowerCase()}...`} /></div>
    <div style={{ ...card, overflow: "hidden" }}><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ background: "#F8FAFF", color: C.sub, textAlign: "left" }}>{(isStudent ? [["sid", "Student ID"], ["name", "Name"], ["cls", "Class"], ["sec", "Section"], ["parentname", "Parent"], ["status", "Status"]] : [["tid", "Teacher ID"], ["name", "Name"], ["phone", "Phone"], ["subject", "Subject"], ["status", "Status"]]).map(([key, label]) => <th key={String(key)} style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{label}</th>)}<th style={{ padding: "12px 14px" }}>Actions</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} style={{ padding: 35, textAlign: "center", color: C.sub }}>Loading…</td></tr> : filtered.length ? filtered.map((r) => <tr key={String(r.id)} style={{ borderTop: `1px solid ${C.border}` }}>{(isStudent ? [["sid", r.sid], ["name", r.name], ["cls", r.cls], ["sec", r.sec], ["parentname", r.parentname], ["status", r.status]] : [["tid", r.tid], ["name", r.name], ["phone", r.phone], ["subject", r.subject], ["status", r.status]]).map(([key, value]) => <td key={String(key)} style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{String(value ?? "—")}</td>)}<td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}><button type="button" onClick={() => openEdit(r)} disabled={saving} style={{ marginRight: 7, border: `1px solid ${C.border}`, borderRadius: 9, padding: "7px 10px", background: "#fff", cursor: "pointer" }}>Edit</button><button type="button" onClick={() => setConfirmDelete(r)} disabled={saving} style={{ border: 0, borderRadius: 9, padding: "7px 10px", background: `${C.red}12`, color: C.red, cursor: "pointer" }}>Delete</button></td></tr>) : <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: C.sub }}>No records found.</td></tr>}</tbody></table></div></div>
    {modal && <div onClick={() => close()} style={{ position: "fixed", inset: 0, background: "rgba(15,27,61,.6)", zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}><div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(720px,100%)", maxHeight: "92vh", overflow: "auto", padding: 22 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}><h3 style={{ margin: 0 }}>{editing ? `Edit ${isStudent ? "Student" : "Teacher"}` : `Add ${isStudent ? "Student" : "Teacher"}`}</h3><button type="button" onClick={close} disabled={saving} style={{ border: 0, borderRadius: 9, padding: 8, background: "#F8FAFF", cursor: "pointer" }}>✕</button></div><div style={{ display: "grid", gap: 13 }}><Input label="Full Name" value={form.name} onChange={(v) => setField("name", v)} required />{isStudent ? <><Input label="Student ID" value={form.sid} onChange={(v) => setField("sid", v)} required /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><Select label="Class" value={form.cls} onChange={(v) => setField("cls", v)} options={CLASSES} required /><Select label="Section" value={form.sec} onChange={(v) => setField("sec", v)} options={SECTIONS} required /></div><Input label="Enrollment Date" value={form.enroll} onChange={(v) => setField("enroll", v)} type="date" required /><Input label="Parent Name" value={form.parentName} onChange={(v) => setField("parentName", v)} required /><Input label="Parent Phone / Login" value={form.parentPhone} onChange={(v) => setField("parentPhone", v)} required /><Input label="Student Password" value={form.password} onChange={(v) => setField("password", v)} type="password" required={!editing} /><Input label="Parent Password" value={form.parentPassword} onChange={(v) => setField("parentPassword", v)} type="password" required={!editing} /></> : <><Input label="Teacher ID" value={form.tid} onChange={(v) => setField("tid", v)} required /><Input label="Phone / Login" value={form.phone} onChange={(v) => setField("phone", v)} required /><MultiSelect label="Subjects" value={teacherSubjects} onChange={setTeacherSubjects} options={SUBJECTS} /><MultiSelect label="Classes" value={teacherClasses} onChange={setTeacherClasses} options={CLASSES} /><Input label="Teacher Password" value={form.password} onChange={(v) => setField("password", v)} type="password" required={!editing} /></>}</div>{error && <div role="alert" style={{ marginTop: 14, color: C.red }}>{error}</div>}<div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 18 }}><button type="button" onClick={close} disabled={saving} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: "#fff", cursor: "pointer" }}>Cancel</button><button type="button" onClick={() => void save()} disabled={saving} style={{ border: 0, borderRadius: 10, padding: "10px 16px", background: C.accent, color: "#fff", fontWeight: 800, cursor: "pointer", opacity: saving ? .6 : 1 }}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Account"}</button></div></div></div>}
    {confirmDelete && <div onClick={() => setConfirmDelete(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,27,61,.6)", zIndex: 60, display: "grid", placeItems: "center", padding: 16 }}><div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(440px,100%)", padding: 22 }}><h3 style={{ marginTop: 0 }}>Delete {isStudent ? "student" : "teacher"}?</h3><p style={{ color: C.sub }}>This will also remove the linked login account{isStudent ? "s" : ""}.</p><div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}><button type="button" onClick={() => setConfirmDelete(null)} disabled={saving} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: "#fff" }}>Cancel</button><button type="button" onClick={() => void remove(confirmDelete)} disabled={saving} style={{ border: 0, borderRadius: 10, padding: "10px 14px", background: C.red, color: "#fff", fontWeight: 800 }}>{saving ? "Deleting…" : "Delete"}</button></div></div></div>}
  </section>;
}
