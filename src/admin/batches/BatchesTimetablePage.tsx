import { useCallback, useEffect, useMemo, useState } from "react";
import { C, addR, delR, gdb, updR } from "@/lg/data";
import { supabase } from "@/lg/supabase";
import { useInstituteWorkspace } from "@/lg/tenant-context";
import { hasInstitutePermission } from "@/lg/tenant";
import { Button, Field, Modal } from "./BatchesTimetableControls";
import { CLASSES, DAYS, SECTIONS, SUBJECTS, css, emptySchedule, type Row, type Option } from "./BatchesTimetableConstants";

export default function BatchesTimetablePage() {
  const { instituteId } = useInstituteWorkspace();
  const [tab, setTab] = useState<"batches" | "timetable">("batches");
  const [batches, setBatches] = useState<Row[]>([]);
  const [students, setStudents] = useState<Row[]>([]);
  const [memberships, setMemberships] = useState<Row[]>([]);
  const [teachers, setTeachers] = useState<Row[]>([]);
  const [timetable, setTimetable] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [batchModal, setBatchModal] = useState(false);
  const [studentModal, setStudentModal] = useState<Row | null>(null);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Row | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Row | null>(null);
  const [deleteBatch, setDeleteBatch] = useState<Row | null>(null);
  const [deleteSchedule, setDeleteSchedule] = useState<Row | null>(null);
  const [query, setQuery] = useState("");
  const [batchForm, setBatchForm] = useState({ name: "", cls: "", sec: "", capacity: "", status: "active", description: "" });
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [scheduleForm, setScheduleForm] = useState(emptySchedule);

  const load = useCallback(async () => {
    if (!instituteId) {
      setError("An active institute workspace must be selected.");
      setLoading(false);
      return;
    }
    setLoading(true); setError("");
    try {
      if (!(await hasInstitutePermission(instituteId, "academics.read"))) throw new Error("Administrator lacks academics.read for this institute workspace.");
      if (!(await hasInstitutePermission(instituteId, "timetable.read"))) throw new Error("Administrator lacks timetable.read for this institute workspace.");
      const [b, s, m, t, tt] = await Promise.all([
        gdb("batches"),
        gdb("students"),
        gdb("batch_students"),
        gdb("teachers"),
        supabase.from("timetable_entries").select("id,batch_id,teacher_id,subject_id,subject_name,subject_names,day_of_week,start_time,end_time,room_id,status,academic_year_id,notes,created_at,updated_at").eq("institute_id", instituteId).eq("status", "active").order("day_of_week").order("start_time"),
      ]);
      if (tt.error) throw tt.error;
      setBatches(b as Row[]); setStudents(s as Row[]); setMemberships(m as Row[]); setTeachers(t as Row[]); setTimetable((tt.data || []) as Row[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load batches and timetable."); }
    finally { setLoading(false); }
  }, [instituteId]);
  useEffect(() => { void load(); }, [load]);

  const activeMemberships = useMemo(() => memberships.filter(m => String(m.status ?? "active") === "active"), [memberships]);
  const filteredBatches = useMemo(() => { const q = query.trim().toLowerCase(); return q ? batches.filter(b => `${b.name} ${b.cls} ${b.sec}`.toLowerCase().includes(q)) : batches; }, [batches, query]);
  const batchOptions: Option[] = batches.filter(b => String(b.status ?? "active") === "active").map(b => ({ v: String(b.id), l: `${b.name} — Class ${b.cls}` }));
  const teacherOptions: Option[] = teachers.filter(t => String(t.status ?? "active") === "active").map(t => ({ v: String(t.id), l: String(t.name ?? t.teacherid ?? t.id) }));
  const selectedBatch = batches.find(b => String(b.id) === String(scheduleForm.batchId));
  const subjectsForBatch = SUBJECTS[String(selectedBatch?.cls ?? "")] ?? [];
  const batchName = (id: unknown): string => String(batches.find(b => String(b.id) === String(id))?.name ?? "Unknown batch");
  const teacherName = (id: unknown): string => String(teachers.find(t => String(t.id) === String(id))?.name ?? teachers.find(t => String(t.id) === String(id))?.teacherid ?? "Unknown teacher");
  const scheduleSubjects = (row: Row): string[] => { const values: string[] = Array.isArray(row.subject_names) ? row.subject_names.map(String) : String(row.subject_name ?? "").split(" + ").map(x => x.trim()).filter(Boolean); return [...new Set(values)]; };

  const openBatch = (b?: Row) => {
    setEditingBatch(b ?? null);
    setBatchForm(b ? { name: String(b.name ?? ""), cls: String(b.cls ?? ""), sec: String(b.sec ?? ""), capacity: b.capacity == null ? "" : String(b.capacity), status: String(b.status ?? "active"), description: String(b.description ?? "") } : { name: "", cls: "", sec: "", capacity: "", status: "active", description: "" });
    setError(""); setBatchModal(true);
  };

  const saveBatch = async () => {
    if (!batchForm.name.trim() || !batchForm.cls) { setError("Batch Name and Class are required."); return; }
    const capacity = batchForm.capacity.trim() ? Number(batchForm.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) { setError("Capacity must be a positive whole number."); return; }
    setSaving(true); setError("");
    try {
      const payload = { name: batchForm.name.trim(), code: batchForm.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, ""), cls: batchForm.cls, sec: batchForm.sec || "All", capacity, status: batchForm.status || "active", description: batchForm.description.trim() };
      if (editingBatch) await updR("batches", editingBatch.id, payload); else await addR("batches", { id: `batch-${Date.now()}`, ...payload });
      setBatchModal(false); await load(); setSuccess(editingBatch ? "Batch updated successfully." : "Batch created successfully.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save batch."); }
    finally { setSaving(false); }
  };

  const openStudents = (b: Row) => { setStudentModal(b); setError(""); setSelectedStudents(activeMemberships.filter(m => String(m.batch_id) === String(b.id)).map(m => String(m.student_id))); };

  const saveStudents = async () => {
    if (!studentModal) return;
    const batchId = String(studentModal.id);
    const current = activeMemberships.filter(m => String(m.batch_id) === batchId);
    const currentIds = new Set(current.map(m => String(m.student_id)));
    const selected = new Set(selectedStudents);
    const additions = selectedStudents.filter(id => !currentIds.has(id));
    const removals = current.filter(m => !selected.has(String(m.student_id)));
    const capacity = studentModal.capacity == null ? null : Number(studentModal.capacity);
    if (capacity !== null && selectedStudents.length > capacity) { setError(`Capacity is ${capacity}; you selected ${selectedStudents.length}.`); return; }
    setSaving(true); setError("");
    try {
      if (!(await hasInstitutePermission(instituteId, "academics.manage"))) throw new Error("Administrator lacks academics.manage for this institute workspace.");
      for (const m of removals) { const { error: e } = await supabase.from("batch_students").delete().eq("institute_id", instituteId).eq("batch_id", batchId).eq("student_id", String(m.student_id)); if (e) throw e; }
      for (const id of additions) await addR("batch_students", { batch_id: batchId, student_id: id, status: "active" });
      setStudentModal(null); await load(); setSuccess("Batch students updated successfully.");
    } catch (e) { await load(); setError(e instanceof Error ? e.message : "Unable to update students. A student may already belong to another active batch."); }
    finally { setSaving(false); }
  };

  const removeBatch = async () => {
    if (!deleteBatch) return;
    setSaving(true); setError("");
    try { await delR("batches", deleteBatch.id); setDeleteBatch(null); await load(); setSuccess("Batch deleted. Student accounts were kept."); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to delete batch."); }
    finally { setSaving(false); }
  };

  const openSchedule = (row?: Row) => {
    setEditingSchedule(row ?? null);
    if (!row) setScheduleForm({ ...emptySchedule, subjects: [], days: [] });
    else setScheduleForm({ batchId: String(row.batch_id ?? ""), teacherId: String(row.teacher_id ?? ""), subjects: scheduleSubjects(row), days: [DAYS[(Number(row.day_of_week) || 1) - 1]].filter(Boolean), start: String(row.start_time ?? "").slice(0, 5), end: String(row.end_time ?? "").slice(0, 5), room: String(row.room_id ?? "") });
    setError(""); setScheduleModal(true);
  };

  const saveSchedule = async () => {
    const subjects = [...new Set(scheduleForm.subjects.map(s => s.trim()).filter(Boolean))];
    if (!scheduleForm.batchId || !scheduleForm.teacherId || !subjects.length || !scheduleForm.days.length || !scheduleForm.start || !scheduleForm.end) { setError("Select batch, teacher, at least one subject, at least one day, start time and end time."); return; }
    if (scheduleForm.end <= scheduleForm.start) { setError("End time must be after start time."); return; }
    setSaving(true); setError("");
    try {
      if (!(await hasInstitutePermission(instituteId, "timetable.manage"))) throw new Error("Administrator lacks timetable.manage for this institute workspace.");
      const base = { batch_id: scheduleForm.batchId, teacher_id: scheduleForm.teacherId, subject_names: subjects, subject_name: subjects.join(" + "), start_time: scheduleForm.start, end_time: scheduleForm.end, room_id: scheduleForm.room || null, status: "active" };
      if (editingSchedule) {
        const dayNo = DAYS.indexOf(scheduleForm.days[0]) + 1;
        const { error: e } = await supabase.from("timetable_entries").update({ ...base, day_of_week: dayNo, institute_id: instituteId }).eq("institute_id", instituteId).eq("id", editingSchedule.id);
        if (e) throw e;
      } else {
        for (const day of scheduleForm.days) {
          const dayNo = DAYS.indexOf(day) + 1;
          const id = `tt-${Date.now()}-${dayNo}-${Math.random().toString(36).slice(2, 8)}`;
          const { error: e } = await supabase.from("timetable_entries").insert({ id, ...base, day_of_week: dayNo, institute_id: instituteId });
          if (e) throw e;
        }
      }
      setScheduleModal(false); setEditingSchedule(null); setScheduleForm({ ...emptySchedule }); await load(); setSuccess(editingSchedule ? "Timetable lecture updated successfully." : `${subjects.length} subject${subjects.length === 1 ? "" : "s"} added to the timetable lecture.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save timetable lecture. Check for an overlapping class."); }
    finally { setSaving(false); }
  };

  const removeSchedule = async () => {
    if (!deleteSchedule) return;
    setSaving(true); setError("");
    try {
      if (!(await hasInstitutePermission(instituteId, "timetable.manage"))) throw new Error("Administrator lacks timetable.manage for this institute workspace.");
      const { error: e } = await supabase.from("timetable_entries").delete().eq("institute_id", instituteId).eq("id", String(deleteSchedule.id));
      if (e) throw e;
      setDeleteSchedule(null); await load(); setSuccess("Timetable lecture deleted successfully.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete timetable lecture. Please try again."); }
    finally { setSaving(false); }
  };

  return <><style>{css}</style><div className="bt">
    {error && <div className="card" style={{ padding: 12, marginBottom: 14, color: C.red }}>⚠️ {error}</div>}
    {success && <div className="card" style={{ padding: 12, marginBottom: 14, color: "#15803D" }}>✅ {success}</div>}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}><div><h1 style={{ margin: 0, fontSize: 24 }}>Batches & Timetable</h1><p style={{ margin: "5px 0 0", color: C.sub, fontSize: 13 }}>Manage batches and multi-subject timetable lectures.</p></div><Button onClick={() => void load()} outline>↻ Refresh</Button></div>
    <div className="card" style={{ display: "flex", gap: 6, padding: 7, marginBottom: 18 }}><button type="button" className="btn" onClick={() => setTab("batches")} style={{ background: tab === "batches" ? C.accent : "transparent", color: tab === "batches" ? "#fff" : C.sub }}>👥 Batches</button><button type="button" className="btn" onClick={() => setTab("timetable")} style={{ background: tab === "timetable" ? C.accent : "transparent", color: tab === "timetable" ? "#fff" : C.sub }}>🗓️ Timetable</button></div>
    {loading ? <div className="card" style={{ padding: 45, textAlign: "center", color: C.sub }}>Loading…</div> : tab === "batches" ? <>
      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 10 }}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search batch name, class or section…" style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 13px" }} /><Button onClick={() => openBatch()}>+ Create Batch</Button></div>
      {filteredBatches.length === 0 ? <div className="card" style={{ padding: 50, textAlign: "center" }}><div style={{ fontSize: 40 }}>👥</div><h3>No batches yet</h3><p style={{ color: C.sub }}>Create your first batch, then add students.</p><Button onClick={() => openBatch()}>+ Create Batch</Button></div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(310px,1fr))", gap: 16 }}>{filteredBatches.map(b => { const count = activeMemberships.filter(m => String(m.batch_id) === String(b.id)).length; return <div key={String(b.id)} className="card" style={{ padding: 20 }}><h3 style={{ margin: 0 }}>{String(b.name ?? "—")}</h3><div style={{ color: C.sub, fontSize: 12, marginTop: 5 }}>Class {String(b.cls ?? "—")}{String(b.sec ?? "") && String(b.sec) !== "All" ? ` · Section ${String(b.sec)}` : ""}</div><div style={{ margin: "18px 0", padding: 14, background: "#F8FAFF", borderRadius: 12 }}><div style={{ fontSize: 26, fontWeight: 900, color: C.accent }}>{count}{b.capacity != null && <span style={{ fontSize: 14, color: C.sub }}> / {String(b.capacity)}</span>}</div><div style={{ fontSize: 11, color: C.sub }}>students in this batch</div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button onClick={() => openStudents(b)}>👥 Students</Button><Button outline onClick={() => openBatch(b)}>Edit</Button><Button outline color={C.red} onClick={() => setDeleteBatch(b)}>Delete</Button></div></div>; })}</div>}
    </> : <>
      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><div><b>Weekly timetable</b><div style={{ color: C.sub, fontSize: 12 }}>A lecture can contain any number of subjects. Edit or delete the complete lecture from here.</div></div><Button onClick={() => openSchedule()}>+ Add Lecture</Button></div>
      <div className="card" style={{ overflow: "auto" }}><table className="table"><thead><tr><th>Batch</th><th>Subjects</th><th>Teacher</th><th>Day</th><th>Time</th><th>Room</th><th>Actions</th></tr></thead><tbody>{timetable.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", padding: 45, color: C.sub }}>No timetable lectures yet. Click <b>+ Add Lecture</b>.</td></tr> : timetable.map(x => <tr key={String(x.id)}><td>{batchName(x.batch_id)}</td><td><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{scheduleSubjects(x).map(s => <span key={String(s)} style={{ background: "#EEF2FF", color: C.accent, borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800 }}>{String(s)}</span>)}</div></td><td>{teacherName(x.teacher_id)}</td><td>{DAYS[(Number(x.day_of_week) || 1) - 1] ?? "—"}</td><td>{String(x.start_time).slice(0, 5)}–{String(x.end_time).slice(0, 5)}</td><td>{String(x.room_id ?? "—")}</td><td><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><Button outline onClick={() => openSchedule(x)}>✏️ Edit</Button><Button outline color={C.red} onClick={() => setDeleteSchedule(x)}>🗑 Delete</Button></div></td></tr>)}</tbody></table></div>
    </>}

    {batchModal && <Modal title={editingBatch ? "Edit Batch" : "Create Batch"} onClose={() => !saving && setBatchModal(false)}><div className="grid"><Field label="Batch Name" value={batchForm.name} onChange={v => setBatchForm(f => ({ ...f, name: v }))} placeholder="10 Morning"/><Field label="Class" value={batchForm.cls} onChange={v => setBatchForm(f => ({ ...f, cls: v }))} options={CLASSES.map(v => ({ v, l: v }))}/><Field label="Section (optional)" value={batchForm.sec} onChange={v => setBatchForm(f => ({ ...f, sec: v }))} options={SECTIONS.map(v => ({ v, l: v }))}/><Field label="Capacity (optional)" value={batchForm.capacity} onChange={v => setBatchForm(f => ({ ...f, capacity: v }))} type="number" placeholder="30"/><Field label="Status" value={batchForm.status} onChange={v => setBatchForm(f => ({ ...f, status: v }))} options={["active", "inactive"].map(v => ({ v, l: v }))}/><label className="field" style={{ gridColumn: "1/-1" }}><span>Description</span><textarea value={batchForm.description} onChange={e => setBatchForm(f => ({ ...f, description: e.target.value }))}/></label></div><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}><Button outline onClick={() => setBatchModal(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveBatch()}>{saving ? "Saving…" : editingBatch ? "Save Changes" : "Create Batch"}</Button></div></Modal>}

    {studentModal && <Modal title={`Students — ${studentModal.name}`} onClose={() => !saving && setStudentModal(null)}><p style={{ color: C.sub, fontSize: 13 }}>Select the active students in this batch. A student can have only one active batch.</p><div style={{ maxHeight: 430, overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 12 }}>{students.filter(s => String(s.status ?? "active") === "active").map(s => { const checked = selectedStudents.includes(String(s.id)); const other = activeMemberships.find(m => String(m.student_id) === String(s.id) && String(m.batch_id) !== String(studentModal.id)); return <label key={String(s.id)} style={{ display: "flex", gap: 10, alignItems: "center", padding: 11, borderBottom: `1px solid ${C.border}`, opacity: other ? .5 : 1 }}><input type="checkbox" checked={checked} disabled={!!other} onChange={() => setSelectedStudents(x => checked ? x.filter(id => id !== String(s.id)) : [...x, String(s.id)])}/><span><b>{String(s.name ?? "—")}</b><small style={{ display: "block", color: C.sub }}>{String(s.sid ?? s.id ?? "—")} · Class {String(s.cls ?? "—")}-{String(s.sec ?? "—")}{other ? " · Already in another batch" : ""}</small></span></label>; })}</div><div style={{ marginTop: 12, color: C.sub, fontSize: 12 }}>{selectedStudents.length} selected</div><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}><Button outline onClick={() => setStudentModal(null)}>Cancel</Button><Button disabled={saving} onClick={() => void saveStudents()}>{saving ? "Saving…" : "Save Students"}</Button></div></Modal>}

    {scheduleModal && <Modal title={editingSchedule ? "Edit Timetable Lecture" : "Add Timetable Lecture"} onClose={() => !saving && setScheduleModal(false)}><div className="grid"><Field label="Batch" value={scheduleForm.batchId} onChange={v => setScheduleForm(f => ({ ...f, batchId: v, subjects: [] }))} options={batchOptions}/><Field label="Teacher" value={scheduleForm.teacherId} onChange={v => setScheduleForm(f => ({ ...f, teacherId: v }))} options={teacherOptions}/><Field label="Room (optional)" value={scheduleForm.room} onChange={v => setScheduleForm(f => ({ ...f, room: v }))} options={["Room 1", "Room 2", "Cabin"].map(v => ({ v, l: v }))}/><Field label="Start Time" value={scheduleForm.start} onChange={v => setScheduleForm(f => ({ ...f, start: v }))} type="time"/><Field label="End Time" value={scheduleForm.end} onChange={v => setScheduleForm(f => ({ ...f, end: v }))} type="time"/></div>
      <div style={{ marginTop: 14 }}><div style={{ fontSize: 12, fontWeight: 750, color: C.sub, marginBottom: 7 }}>Subjects — select as many as needed</div>{!scheduleForm.batchId ? <div style={{ color: C.sub, fontSize: 12 }}>Select a batch first.</div> : <div className="subjects">{subjectsForBatch.map(subject => { const checked = scheduleForm.subjects.includes(subject); return <label key={subject} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} onChange={e => setScheduleForm(f => ({ ...f, subjects: e.target.checked ? [...f.subjects, subject] : f.subjects.filter(s => s !== subject) }))}/> {subject}</label>; })}</div>}{scheduleForm.subjects.length > 0 && <div style={{ marginTop: 8, color: C.sub, fontSize: 12, fontWeight: 700 }}>✓ {scheduleForm.subjects.join(" + ")}</div>}</div>
      {!editingSchedule && <div style={{ marginTop: 14 }}><div style={{ fontSize: 12, fontWeight: 750, color: C.sub, marginBottom: 7 }}>Days — add this lecture to one or more days</div><div className="days">{DAYS.map(day => { const checked = scheduleForm.days.includes(day); return <label key={day} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} onChange={e => setScheduleForm(f => ({ ...f, days: e.target.checked ? [...f.days, day] : f.days.filter(d => d !== day) }))}/> {day}</label>; })}</div></div>}
      {editingSchedule && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#F8FAFF", color: C.sub, fontSize: 12 }}>Editing one lecture keeps its existing day. To change the day, use a new lecture entry.</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}><Button outline onClick={() => setScheduleModal(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveSchedule()}>{saving ? "Saving…" : editingSchedule ? "Save Changes" : "Add Lecture"}</Button></div></Modal>}

    {deleteBatch && <Modal title="Delete Batch" onClose={() => !saving && setDeleteBatch(null)}><p style={{ color: C.sub }}>Delete <b>{String(deleteBatch.name ?? "—")}</b>? Students will not be deleted.</p><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><Button outline onClick={() => setDeleteBatch(null)}>Cancel</Button><Button color={C.red} disabled={saving} onClick={() => void removeBatch()}>Delete Batch</Button></div></Modal>}
    {deleteSchedule && <Modal title="Delete Timetable Lecture" onClose={() => !saving && setDeleteSchedule(null)}><p style={{ color: C.sub }}>Delete this complete lecture from the timetable?</p><div style={{ margin: "12px 0", padding: 12, background: "#FFF7ED", borderRadius: 10, fontSize: 12 }}><b>{scheduleSubjects(deleteSchedule).join(" + ")}</b><br/>{DAYS[(Number(deleteSchedule.day_of_week) || 1) - 1]} · {String(deleteSchedule.start_time).slice(0, 5)}–{String(deleteSchedule.end_time).slice(0, 5)}</div><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><Button outline onClick={() => setDeleteSchedule(null)}>Cancel</Button><Button color={C.red} disabled={saving} onClick={() => void removeSchedule()}>{saving ? "Deleting…" : "Delete Lecture"}</Button></div></Modal>}
  </div></>;
}