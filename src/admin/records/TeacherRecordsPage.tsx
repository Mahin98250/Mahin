import { useCallback, useEffect, useMemo, useState } from "react";
import { C, addR, delR, gdb, updR } from "@/lg/data";
import { provision, nextId } from "./AdminRecordsAuth";
import { DEFAULT_TEACHER_PASSWORD } from "./AdminRecordsConstants";

type Row = Record<string, unknown> & { id: string | number };

const SUBJECTS = ["Mathematics", "Science", "English", "History", "Geography", "Computer", "Hindi"];

const card: React.CSSProperties = { background: "#fff", borderRadius: 20, boxShadow: "0 4px 20px rgba(15,27,61,.07)", border: "1px solid #EEF2FF", overflow: "hidden" };

function Field({ label, value, onChange, ph = "", required = false, type = "text", note = "" }: { label: string; value: string; onChange: (value: string) => void; ph?: string; required?: boolean; type?: string; note?: string }) {
  return <label style={{ display: "block", marginBottom: 14 }}><span style={{ display: "block", fontSize: 12, fontWeight: 750, color: C.sub, marginBottom: 6 }}>{label}{required && <span style={{ color: C.red }}> *</span>}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} required={required} style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", border: `1.5px solid ${C.border}`, borderRadius: 11, background: "#F8FAFF", color: C.text, outline: "none" }} />{note && <span style={{ display: "block", marginTop: 5, fontSize: 10, color: C.sub }}>{note}</span>}</label>;
}

function Select({ label, value, onChange, options, required = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; required?: boolean }) {
  return <label style={{ display: "block", marginBottom: 14 }}><span style={{ display: "block", fontSize: 12, fontWeight: 750, color: C.sub, marginBottom: 6 }}>{label}{required && <span style={{ color: C.red }}> *</span>}</span><select value={value} onChange={(e) => onChange(e.target.value)} required={required} style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", border: `1.5px solid ${C.border}`, borderRadius: 11, background: "#F8FAFF", color: C.text, outline: "none" }}><option value="">Select...</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

export default function TeacherRecordsPage() {
  const [list, setList] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | number | null>(null);
  const [confirmId, setConfirmId] = useState<string | number | null>(null);
  const [form, setForm] = useState({ name: "", tid: "", subject: "", phone: "", pass: DEFAULT_TEACHER_PASSWORD, status: "active" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => { setList((await gdb("teachers")) as Row[]); }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? list.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))) : list; }, [list, query]);

  const openNew = async () => { setError(""); setSuccess(""); setEditId(null); setForm({ name: "", tid: await nextId("teachers"), subject: "", phone: "", pass: DEFAULT_TEACHER_PASSWORD, status: "active" }); setModal(true); };
  const openEdit = (row: Row) => { setError(""); setSuccess(""); setEditId(row.id); setForm({ name: String(row.name ?? ""), tid: String(row.tid ?? ""), subject: String(row.subject ?? ""), phone: String(row.phone ?? ""), pass: String(row.pass ?? DEFAULT_TEACHER_PASSWORD), status: String(row.status ?? "active") }); setModal(true); };
  const close = () => { if (!saving) { setModal(false); setEditId(null); setError(""); } };

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.subject) { setError("❌ Fill Name, Phone, and select a Subject."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      if (editId !== null) {
        await updR("teachers", editId, { name: form.name.trim(), tid: form.tid.trim(), subject: form.subject, phone: form.phone.trim(), status: form.status, pass: form.pass || DEFAULT_TEACHER_PASSWORD, updated_at: new Date().toISOString() });
        const users = (await gdb("users")) as Row[];
        const user = users.find((u) => String(u.ref ?? "") === String(editId) && String(u.role ?? "") === "teacher");
        const auth = await provision("teacher", form.phone.trim(), form.name.trim(), String(editId), "update", user?.auth_id ? String(user.auth_id) : null, form.pass || DEFAULT_TEACHER_PASSWORD);
        if (auth.authId) {
          if (user) await updR("users", user.id, { name: form.name.trim(), phone: form.phone.trim(), email: auth.email, status: form.status, pass: form.pass || DEFAULT_TEACHER_PASSWORD, auth_id: auth.authId });
          else await addR("users", { id: `u-${auth.authId}`, name: form.name.trim(), phone: form.phone.trim(), email: auth.email, role: "teacher", ref: editId, status: form.status, pass: form.pass || DEFAULT_TEACHER_PASSWORD, auth_id: auth.authId });
        }
        setSuccess("Teacher updated!");
      } else {
        const tid = form.tid || await nextId("teachers");
        const teacher = await addR("teachers", { id: `t-${Date.now()}`, name: form.name.trim(), tid, subject: form.subject, phone: form.phone.trim(), pass: form.pass || DEFAULT_TEACHER_PASSWORD, classes: [], status: form.status || "active", created_at: new Date().toISOString() });
        try {
          const auth = await provision("teacher", form.phone.trim(), form.name.trim(), String(teacher.id), "create", null, form.pass || DEFAULT_TEACHER_PASSWORD);
          await addR("users", { id: `u-${auth.authId}`, name: form.name.trim(), phone: form.phone.trim(), email: auth.email, role: "teacher", ref: teacher.id, status: form.status || "active", pass: form.pass || DEFAULT_TEACHER_PASSWORD, auth_id: auth.authId });
        } catch (accountError) { await delR("teachers", teacher.id); throw accountError; }
        setSuccess(`Teacher "${form.name.trim()}" added! Login account created ✅`);
      }
      setModal(false); setEditId(null); await refresh();
    } catch (e) { setError(`❌ Error saving teacher: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (confirmId === null) return;
    try {
      const users = (await gdb("users")) as Row[];
      for (const user of users.filter((u) => String(u.ref ?? "") === String(confirmId) && String(u.role ?? "") === "teacher")) {
        try { await provision("teacher", String(user.phone ?? ""), String(user.name ?? "Teacher"), String(confirmId), "delete", user.auth_id ? String(user.auth_id) : null); } catch { /* stale Auth accounts are already gone */ }
        await delR("users", user.id);
      }
      await delR("teachers", confirmId);
      setConfirmId(null); setSuccess("Teacher and their account deleted."); await refresh();
    } catch (e) { setError(`❌ Error deleting teacher: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return <div style={{ padding: 28, overflowY: "auto", background: "#F7F9FF", minHeight: "100%" }}>
    {success && <div className="fu" style={{ background: "#DCFCE7", borderRadius: 14, padding: "12px 18px", marginBottom: 18, color: "#16A34A", fontWeight: 700, fontSize: 14 }}>✅ {success}</div>}
    {error && <div style={{ ...card, padding: 13, marginBottom: 18, background: "#FFF7F7", color: C.red, fontWeight: 650 }}>{error}</div>}
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍  Search by name or ID…" style={{ flex: 1, minWidth: 220, maxWidth: 620, padding: "10px 16px", borderRadius: 12, border: `1.5px solid ${C.border}`, background: "#fff", outline: "none" }} /><button type="button" onClick={() => void openNew()} style={{ border: 0, borderRadius: 12, padding: "11px 16px", background: C.accent, color: "#fff", fontWeight: 800, cursor: "pointer" }}>👨‍🏫 + Add Teacher</button></div>
    <div style={card}><div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse" }}><thead><tr>{["Teacher ID", "Name", "Subject", "Phone (Login)", "Assigned Classes", "Status", "Actions"].map((h) => <th key={h} style={{ textAlign: "left", padding: "12px 14px", background: "#F8FAFF", color: C.sub, fontSize: 12, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead><tbody>{filtered.length ? filtered.map((r) => <tr key={String(r.id)}><td style={{ padding: "12px 14px", fontSize: 13 }}>{String(r.tid ?? "—")}</td><td style={{ padding: "12px 14px", fontSize: 13, fontWeight: 700 }}>{String(r.name ?? "—")}</td><td style={{ padding: "12px 14px", fontSize: 13 }}>{String(r.subject ?? "—")}</td><td style={{ padding: "12px 14px", fontSize: 13 }}>{String(r.phone ?? "—")}</td><td style={{ padding: "12px 14px", fontSize: 12 }}>{(Array.isArray(r.classes) ? r.classes : String(r.classes ?? "").split(",").map((v) => v.trim()).filter(Boolean)).join(", ") || "—"}</td><td style={{ padding: "12px 14px", fontSize: 12 }}><span style={{ background: String(r.status ?? "active").toLowerCase() === "inactive" ? "#F1F5F9" : "#DCFCE7", color: String(r.status ?? "active").toLowerCase() === "inactive" ? "#64748B" : "#16A34A", padding: "3px 10px", borderRadius: 20, fontWeight: 800 }}>{String(r.status ?? "active")}</span></td><td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}><button type="button" onClick={() => openEdit(r)} style={{ border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, borderRadius: 8, padding: "7px 10px", cursor: "pointer", marginRight: 6 }}>Edit</button><button type="button" onClick={() => setConfirmId(r.id)} style={{ border: 0, background: "#FFF1F2", color: C.red, borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>🗑</button></td></tr>) : <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: C.sub }}>No teachers found.</td></tr>}</tbody></table></div></div>

    {modal && <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,27,61,.6)", display: "grid", placeItems: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><div style={{ background: "#fff", borderRadius: 20, width: "min(560px,100%)", maxHeight: "92vh", overflowY: "auto", padding: 26, boxShadow: "0 24px 72px rgba(15,27,61,.25)" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}><div><h2 style={{ margin: 0, color: C.text, fontSize: 20 }}>{editId !== null ? "Edit Teacher" : "Add New Teacher"}</h2><p style={{ margin: "5px 0 0", color: C.sub, fontSize: 12 }}>{editId !== null ? "Edit teacher details below." : "Teacher login account will be created automatically."}</p></div><button type="button" onClick={close} style={{ border: 0, background: "#F8FAFF", color: C.sub, borderRadius: 9, padding: 8, cursor: "pointer" }}>✕</button></div><Field label="Full Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} ph="Teacher name" required /><Field label="Teacher ID" value={form.tid} onChange={(v) => setForm((f) => ({ ...f, tid: v }))} ph="e.g. LGT01" required /><Select label="Subject" value={form.subject} onChange={(v) => setForm((f) => ({ ...f, subject: v }))} options={SUBJECTS} required /><Field label="Phone (Login ID)" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} ph="10-digit mobile" required note="Teacher logs in with this phone number" /><Field label="Password" value={form.pass} onChange={(v) => setForm((f) => ({ ...f, pass: v }))} ph="Default: Teacher@1234" required /><Select label="Status" value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} options={["active", "inactive"]} /><div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}><button type="button" onClick={close} style={{ border: `1px solid ${C.sub}`, background: "transparent", color: C.sub, borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>Cancel</button><button type="button" onClick={() => void save()} disabled={saving} style={{ border: 0, background: C.accent, color: "#fff", borderRadius: 10, padding: "10px 16px", fontWeight: 800, cursor: saving ? "wait" : "pointer", opacity: saving ? .7 : 1 }}>{saving ? "Saving…" : editId !== null ? "Save Changes" : "👨‍🏫 Add Teacher"}</button></div></div></div>}

    {confirmId !== null && <div style={{ position: "fixed", inset: 0, zIndex: 110, background: "rgba(15,27,61,.6)", display: "grid", placeItems: "center", padding: 16 }}><div style={{ background: "#fff", borderRadius: 18, width: "min(420px,100%)", padding: 24 }}><h3 style={{ margin: "0 0 8px", color: C.text }}>Delete Teacher?</h3><p style={{ margin: "0 0 20px", color: C.sub, fontSize: 13 }}>Delete this teacher and their account?</p><div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}><button type="button" onClick={() => setConfirmId(null)} style={{ border: `1px solid ${C.border}`, background: "#fff", borderRadius: 10, padding: "9px 14px", cursor: "pointer" }}>Cancel</button><button type="button" onClick={() => void remove()} style={{ border: 0, background: C.red, color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>Delete</button></div></div></div>}
  </div>;
}
