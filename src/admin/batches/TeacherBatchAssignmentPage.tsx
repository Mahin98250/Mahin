import { useCallback, useEffect, useMemo, useState } from "react";
import { gdb } from "@/lg/data";
import { supabase } from "@/lg/supabase";
import { hasInstitutePermission } from "@/lg/tenant";
import { getCurrentInstituteContext } from "@/lg/tenant";

type Row = Record<string, any> & { id?: string | number };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TeacherBatchAssignmentPage() {
  const [batches, setBatches] = useState<Row[]>([]);
  const [teachers, setTeachers] = useState<Row[]>([]);
  const [subjects, setSubjects] = useState<Row[]>([]);
  const [batchId, setBatchId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [start, setStart] = useState("17:00");
  const [end, setEnd] = useState("18:00");
  const [room, setRoom] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, t, s] = await Promise.all([gdb("batches"), gdb("teachers"), gdb("subjects")]);
      setBatches((b as Row[]).filter((x) => String(x.status ?? "active") === "active"));
      setTeachers((t as Row[]).filter((x) => String(x.status ?? "active") === "active"));
      setSubjects(s as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load assignment data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedBatch = useMemo(() => batches.find((b) => String(b.id) === batchId), [batches, batchId]);
  const classSubjects = useMemo(() => {
    const cls = String(selectedBatch?.cls ?? "");
    const filtered = subjects.filter((s) => !s.cls || String(s.cls) === cls);
    return filtered.length ? filtered : subjects;
  }, [selectedBatch, subjects]);

  const toggle = (list: string[], value: string, setter: (next: string[]) => void) => {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const save = async () => {
    const context = await getCurrentInstituteContext();
    const instituteId = context.membership?.institute_id;
    if (!instituteId) throw new Error("An active institute workspace must be selected.");
    setError("");
    setMessage("");
    if (!batchId || !teacherId || !subjectIds.length || !days.length || !start || !end) {
      setError("Select a batch, teacher, at least one subject, at least one day, and both times.");
      return;
    }
    if (end <= start) {
      setError("End time must be after start time.");
      return;
    }
    setSaving(true);
    try {
      const chosenSubjects = subjectIds
        .map((id) => subjects.find((s) => String(s.id) === id))
        .filter(Boolean) as Row[];
      for (const subject of chosenSubjects) {
        const subjectName = String(subject.name ?? subject.subject_name ?? subject.title ?? subject.id);
        const { error: assignmentError } = await supabase.from("batch_teachers").upsert(
          {
            institute_id: instituteId,
            batch_id: batchId,
            teacher_id: teacherId,
            subject_id: String(subject.id),
            subject_name: subjectName,
            status: "active",
          },
          { onConflict: "batch_id,teacher_id,subject_id" },
        );
        if (assignmentError) throw assignmentError;

        for (const day of days) {
          const dayNo = DAYS.indexOf(day) + 1;
          const { error: timetableError } = await supabase.from("timetable_entries").insert({
            id: `tt-${Date.now()}-${dayNo}-${String(subject.id)}-${Math.random().toString(36).slice(2, 7)}`,
            institute_id: instituteId,
            batch_id: batchId,
            teacher_id: teacherId,
            subject_name: subjectName,
            day_of_week: dayNo,
            start_time: start,
            end_time: end,
            room_id: room || null,
            status: "active",
          });
          if (timetableError) throw timetableError;
        }
      }
      setMessage(`${chosenSubjects.length} subject(s) assigned to the teacher and added to the timetable.`);
      setSubjectIds([]);
      setDays([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save teacher assignment.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 28 }}>Loading teacher assignments…</div>;

  return (
    <div style={{ padding: 24, background: "#F7F9FF", minHeight: "100vh", color: "#0F1B3D" }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>Teacher Batch Assignment</h1>
      <p style={{ color: "#64748B" }}>Assign one teacher to a batch with multiple subjects in one operation.</p>
      {error && <div style={{ padding: 12, margin: "12px 0", background: "#FEF2F2", color: "#B91C1C", borderRadius: 10 }}>{error}</div>}
      {message && <div style={{ padding: 12, margin: "12px 0", background: "#F0FDF4", color: "#166534", borderRadius: 10 }}>{message}</div>}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, padding: 20 }}>
        <label style={{ display: "block", marginBottom: 14 }}>Batch<select value={batchId} onChange={(e) => { setBatchId(e.target.value); setSubjectIds([]); }} style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }}><option value="">Select batch…</option>{batches.map((b) => <option key={String(b.id)} value={String(b.id)}>{b.name} — Class {b.cls}</option>)}</select></label>
        <label style={{ display: "block", marginBottom: 14 }}>Teacher<select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }}><option value="">Select teacher…</option>{teachers.map((t) => <option key={String(t.id)} value={String(t.id)}>{t.name ?? t.teacherid ?? t.id}</option>)}</select></label>
        <div style={{ marginBottom: 16 }}><b>Subjects — select one or more</b><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginTop: 8 }}>{classSubjects.map((s) => { const id = String(s.id); const checked = subjectIds.includes(id); return <label key={id} style={{ display: "flex", gap: 8, padding: 10, border: `1px solid ${checked ? "#4361EE" : "#E2E8F0"}`, borderRadius: 10 }}><input type="checkbox" checked={checked} onChange={() => toggle(subjectIds, id, setSubjectIds)} />{s.name ?? s.subject_name ?? s.title ?? id}</label>; })}</div></div>
        <div style={{ marginBottom: 16 }}><b>Days — select one or more</b><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{DAYS.map((day) => <label key={day} style={{ padding: 9, border: "1px solid #E2E8F0", borderRadius: 10 }}><input type="checkbox" checked={days.includes(day)} onChange={() => toggle(days, day, setDays)} /> {day}</label>)}</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}><label>Start<input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} /></label><label>End<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} /></label><label>Room<input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Optional" style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} /></label></div>
        <button type="button" disabled={saving} onClick={() => void save()} style={{ marginTop: 18, border: 0, borderRadius: 10, padding: "11px 16px", background: "#4361EE", color: "#fff", fontWeight: 800, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Assign Teacher & Save Schedule"}</button>
      </div>
    </div>
  );
}
