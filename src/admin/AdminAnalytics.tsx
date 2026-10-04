import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lg/supabase";
import { hasInstitutePermission } from "@/lg/tenant";
import { useInstituteWorkspace } from "@/lg/tenant-context";

type Row = Record<string, any>;
type ProfileType = "student" | "teacher";
const C = {
  bg: "#F0F4FF",
  card: "#fff",
  text: "#0F1B3D",
  sub: "#64748B",
  border: "#E2E8F0",
  accent: "#4361EE",
  green: "#22C55E",
  red: "#EF4444",
  amber: "#F59E0B",
  purple: "#8B5CF6",
};
const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 18,
  boxShadow: "0 4px 18px rgba(15,27,61,.07)",
};
const btn = (active = false): React.CSSProperties => ({
  border: 0,
  borderRadius: 10,
  padding: "9px 13px",
  background: active ? C.accent : "#EEF2FF",
  color: active ? "#fff" : C.text,
  fontWeight: 800,
  cursor: "pointer",
});
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const safe = (v: any) => String(v ?? "").trim();
const score = (r: Row) => Number(r.marks ?? r.score ?? 0);
const total = (r: Row) => Number(r.total ?? r.totalMarks ?? 100) || 100;

function Metric({ label, value, hint, color = C.accent }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return <div style={{ ...card, padding: 18 }}><div style={{ color: C.sub, fontSize: 12, fontWeight: 700 }}>{label}</div><div style={{ fontSize: 28, fontWeight: 900, color, marginTop: 5 }}>{value}</div>{hint && <div style={{ color: C.sub, fontSize: 11, marginTop: 4 }}>{hint}</div>}</div>;
}
function Empty({ text }: { text: string }) { return <div style={{ padding: 24, color: C.sub, textAlign: "center", fontSize: 13 }}>{text}</div>; }
function BarChart({ values, labels, color = C.accent, suffix = "%" }: { values: Array<number | null>; labels: string[]; color?: string; suffix?: string }) {
  const known = values.filter((v): v is number => typeof v === "number");
  if (!known.length) return <Empty text="No data available for this chart yet." />;
  const max = Math.max(100, ...known);
  return <div style={{ display: "flex", gap: 9, alignItems: "flex-end", height: 190, paddingTop: 8 }}>{values.map((v, i) => <div key={`${labels[i]}-${i}`} style={{ flex: 1, minWidth: 0, textAlign: "center" }}><div style={{ height: 145, display: "flex", alignItems: "flex-end" }}><div title={v == null ? "No data" : `${v}${suffix}`} style={{ width: "100%", height: v == null ? 2 : `${Math.max(5, (v / max) * 100)}%`, background: v == null ? C.border : color, borderRadius: "7px 7px 2px 2px" }} /></div><div style={{ fontSize: 10, color: C.sub, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis" }}>{labels[i]}</div><div style={{ fontSize: 10, fontWeight: 800, color }}>{v == null ? "—" : `${v}${suffix}`}</div></div>)}</div>;
}
function LineChart({ points }: { points: Array<{ label: string; value: number | null }> }) {
  const known = points.filter((p) => p.value != null) as Array<{ label: string; value: number }>;
  if (!known.length) return <Empty text="No attendance data recorded yet." />;
  const w = 700, h = 220, pad = 30, max = 100;
  const path = known.map((p, i) => { const x = pad + (i * (w - pad * 2)) / Math.max(1, known.length - 1); const y = h - pad - (p.value / max) * (h - pad * 2); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  return <div style={{ overflowX: "auto" }}><svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", minWidth: 500, height: 220 }} role="img" aria-label="Attendance trend">{[0, 25, 50, 75, 100].map((v) => { const y = h - pad - (v / max) * (h - pad * 2); return <g key={v}><line x1={pad} x2={w - pad} y1={y} y2={y} stroke={C.border} /><text x={2} y={y + 4} fontSize="10" fill={C.sub}>{v}%</text></g>; })}<path d={path} fill="none" stroke={C.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />{known.map((p, i) => { const x = pad + (i * (w - pad * 2)) / Math.max(1, known.length - 1); const y = h - pad - (p.value / max) * (h - pad * 2); return <g key={`${p.label}-${i}`}><circle cx={x} cy={y} r="5" fill={C.accent} /><text x={x} y={h - 8} textAnchor="middle" fontSize="10" fill={C.sub}>{p.label}</text></g>; })}</svg></div>;
}

const DASHBOARD_SELECTS = {
  students: "id,name,sid,cls,sec,status", teachers: "id,name,tid,subject,status", attendance: "id,sid,date,status,by,created_at", fees: "id,sid,amount,status,due,created_at", homework: "id,tid,cls,sec,subject,due,created_at", announcements: "id,title,target,date,created_at",
} as const;
const PROFILE_SELECTS = {
  students: "id,name,sid,cls,sec,parentname,parentphone,parent,enroll,status,created_at", teachers: "id,name,tid,subject,phone,classes,status,created_at",
} as const;
const PROFILE_DETAIL_SELECTS = {
  student: { attendance: "id,sid,date,status,by,created_at,leave_request_id", marks: "id,sid,subject,exam,marks,total,date,tid,created_at,totalMarks,score", homework: "id,cls,sec,subject,desc,given,due,tid,completedby,pdfname,created_at,batch_id,storage_path,file_size,mime_type", fees: "id,sid,desc,amount,due,status,paidon,created_at", exams: "id,title,subject,cls,sec,date,starttime,endtime,venue,syllabus,totalmarks,createdby,created_at,startTime,endTime,totalMarks" },
  teacher: { attendance: "id,sid,date,status,by,created_at,leave_request_id", homework: "id,cls,sec,subject,desc,given,due,tid,completedby,pdfname,created_at,batch_id,storage_path,file_size,mime_type", marks: "id,sid,subject,exam,marks,total,date,tid,created_at,totalMarks,score", timetable: "id,cls,sec,tid,subject,day,starttime,endtime,date,created_at,startTime,endTime" },
} as const;

export function AdminDashboardAnalytics({ onBack }: { onBack?: () => void }) {
  const { instituteId } = useInstituteWorkspace();
  const [students, setStudents] = useState<Row[]>([]), [teachers, setTeachers] = useState<Row[]>([]), [attendance, setAttendance] = useState<Row[]>([]), [fees, setFees] = useState<Row[]>([]), [homework, setHomework] = useState<Row[]>([]), [announcements, setAnnouncements] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => { let live = true; (async () => { setLoading(true); if (!instituteId) { setError("An active institute workspace must be selected."); setLoading(false); return; } const results = await Promise.all([supabase.from("students").select(DASHBOARD_SELECTS.students).eq("institute_id", instituteId), supabase.from("teachers").select(DASHBOARD_SELECTS.teachers).eq("institute_id", instituteId), supabase.from("attendance").select(DASHBOARD_SELECTS.attendance).eq("institute_id", instituteId), supabase.from("fees").select(DASHBOARD_SELECTS.fees).eq("institute_id", instituteId), supabase.from("homework").select(DASHBOARD_SELECTS.homework).eq("institute_id", instituteId), supabase.from("announcements").select(DASHBOARD_SELECTS.announcements).eq("institute_id", instituteId).order("created_at", { ascending: false })]); const firstError = results.find((r) => r.error)?.error; if (!live) return; if (firstError) setError(firstError.message); else { setStudents(results[0].data || []); setTeachers(results[1].data || []); setAttendance(results[2].data || []); setFees(results[3].data || []); setHomework(results[4].data || []); setAnnouncements(results[5].data || []); } setLoading(false); })(); return () => { live = false; }; }, [instituteId]);
  const attendanceRate = pct(attendance.filter((a) => safe(a.status).toLowerCase() === "present").length, attendance.length);
  const last14 = useMemo(() => { const days: string[] = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); } return days.map((d) => { const rows = attendance.filter((a) => safe(a.date).slice(0, 10) === d); const present = rows.filter((a) => safe(a.status).toLowerCase() === "present").length; return { label: d.slice(5), value: pct(present, rows.length) }; }); }, [attendance]);
  const feeTotals = useMemo(() => ({ paid: fees.filter((f) => safe(f.status).toLowerCase() === "paid").reduce((n, f) => n + Number(f.amount || 0), 0), pending: fees.filter((f) => safe(f.status).toLowerCase() === "pending").reduce((n, f) => n + Number(f.amount || 0), 0), overdue: fees.filter((f) => safe(f.status).toLowerCase() === "overdue").reduce((n, f) => n + Number(f.amount || 0), 0) }), [fees]);
  return <div style={{ minHeight: "100%", background: C.bg, padding: 26, color: C.text, fontFamily: "Poppins,system-ui,sans-serif" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}><div><h2 style={{ margin: 0 }}>📊 Real Institute Analytics</h2><div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Every number below comes from the database. No sample or fallback statistics.</div></div>{onBack && <button style={btn()} onClick={onBack}>← Admin Panel</button>}</div>{error && <div style={{ ...card, padding: 14, color: C.red, marginBottom: 14 }}>{error}</div>}{loading ? <div style={{ ...card, padding: 30, textAlign: "center", color: C.sub }}>Loading live analytics…</div> : <><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14 }}><Metric label="Students" value={students.length} /><Metric label="Teachers" value={teachers.length} color={C.purple} /><Metric label="Attendance" value={attendanceRate == null ? "—" : `${attendanceRate}%`} hint={attendance.length ? `${attendance.length} records` : "No attendance records"} color={C.green} /><Metric label="Homework" value={homework.length} /><Metric label="Pending Fees" value={`₹${feeTotals.pending.toLocaleString("en-IN")}`} color={C.amber} /><Metric label="Announcements" value={announcements.length} color={C.purple} /></div><div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(280px,1fr)", gap: 16, marginTop: 16 }}><div style={{ ...card, padding: 20 }}><h3 style={{ marginTop: 0 }}>Attendance — last 14 days</h3><LineChart points={last14} /></div><div style={{ ...card, padding: 20 }}><h3 style={{ marginTop: 0 }}>Fee collection</h3><BarChart values={[feeTotals.paid, feeTotals.pending, feeTotals.overdue].map((v) => fees.length ? Math.round((v / Math.max(1, feeTotals.paid + feeTotals.pending + feeTotals.overdue)) * 100) : null)} labels={["Paid", "Pending", "Overdue"]} color={C.green} /><div style={{ display: "grid", gap: 8 }}><div>Collected <b>₹{feeTotals.paid.toLocaleString("en-IN")}</b></div><div>Pending <b>₹{feeTotals.pending.toLocaleString("en-IN")}</b></div><div>Overdue <b>₹{feeTotals.overdue.toLocaleString("en-IN")}</b></div></div></div></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}><div style={{ ...card, padding: 20 }}><h3 style={{ marginTop: 0 }}>Recent students</h3>{students.slice(0, 8).map((s) => <div key={s.id} style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}` }}><b>{s.name || "Unnamed"}</b><div style={{ fontSize: 11, color: C.sub }}>Class {s.cls || "—"}-{s.sec || "—"} · {s.sid || s.id}</div></div>)}{!students.length && <Empty text="No students in the database." />}</div><div style={{ ...card, padding: 20 }}><h3 style={{ marginTop: 0 }}>Recent announcements</h3>{announcements.slice(0, 8).map((a) => <div key={a.id} style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}` }}><b>{a.title || "Untitled"}</b><div style={{ fontSize: 11, color: C.sub }}>{a.date || a.created_at || "—"} · {a.target || "all"}</div></div>)}{!announcements.length && <Empty text="No announcements in the database." />}</div></div></>}</div>;
}

export function AdminProfileAnalytics({ onBack }: { onBack?: () => void }) {
  const { instituteId } = useInstituteWorkspace();
  const [type, setType] = useState<ProfileType>("student"), [q, setQ] = useState(""), [students, setStudents] = useState<Row[]>([]), [teachers, setTeachers] = useState<Row[]>([]), [selected, setSelected] = useState<Row | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => { let live = true; (async () => { if (!instituteId) { setError("An active institute workspace must be selected."); setLoading(false); return; } const [s, t] = await Promise.all([supabase.from("students").select(PROFILE_SELECTS.students).eq("institute_id", instituteId), supabase.from("teachers").select(PROFILE_SELECTS.teachers).eq("institute_id", instituteId)]); if (!live) return; const e = s.error || t.error; if (e) setError(e.message); setStudents(s.data || []); setTeachers(t.data || []); setLoading(false); })(); return () => { live = false; }; }, [instituteId]);
  const list = (type === "student" ? students : teachers).filter((x) => `${x.name || ""} ${type === "student" ? x.sid || x.id : x.tid || x.id} ${x.phone || ""}`.toLowerCase().includes(q.toLowerCase()));
  return <div style={{ minHeight: "100%", background: C.bg, padding: 26, color: C.text, fontFamily: "Poppins,system-ui,sans-serif" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}><div><h2 style={{ margin: 0 }}>🔎 Profile Analytics</h2><div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Open a student or teacher for a live performance profile.</div></div>{onBack && <button style={btn()} onClick={onBack}>← Admin Panel</button>}</div>{error && <div style={{ ...card, padding: 14, color: C.red, marginBottom: 14 }}>{error}</div>}<div style={{ ...card, padding: 18 }}><div style={{ display: "flex", gap: 8, marginBottom: 12 }}><button style={btn(type === "student")} onClick={() => { setType("student"); setSelected(null); }}>🎓 Students</button><button style={btn(type === "teacher")} onClick={() => { setType("teacher"); setSelected(null); }}>👨‍🏫 Teachers</button></div><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or phone…" style={{ width: "100%", padding: "12px 14px", border: `1px solid ${C.border}`, borderRadius: 11, background: "#F8FAFF", outline: "none", marginBottom: 10 }} />{!selected ? (loading ? <Empty text="Loading profiles…" /> : list.length ? <div>{list.slice(0, 50).map((x) => <button key={x.id} onClick={() => setSelected(x)} style={{ width: "100%", textAlign: "left", border: 0, borderTop: `1px solid ${C.border}`, background: "transparent", padding: "13px 4px", cursor: "pointer" }}><b>{x.name || "Unnamed"}</b><div style={{ fontSize: 11, color: C.sub }}>{type === "student" ? `Student ID ${x.sid || x.id} · Class ${x.cls || "—"}-${x.sec || "—"}` : `Teacher ID ${x.tid || x.id} · ${x.subject || "—"}`}</div></button>)}</div> : <Empty text="No matching profiles." />) : <ProfileDetail type={type} profile={selected} onBack={() => setSelected(null)} />}</div></div>;
}

function ProfileDetail({ type, profile, onBack }: { type: ProfileType; profile: Row; onBack: () => void }) {
  const [data, setData] = useState<Record<string, Row[]>>({}), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const id = safe(type === "student" ? profile.sid || profile.id : profile.tid || profile.id);
      // Both branches have different projection keys; treating the selected set as
      // a string map keeps the discriminated runtime shape while preventing TS
      // from trying to prove impossible cross-branch property access.
      const selectSet = PROFILE_DETAIL_SELECTS[type] as Record<string, string>;
      const configs: Array<{ key: string; table: string; select: string; filter: [string, string]; extraFilter?: [string, string] }> = type === "student" ? [
        { key: "attendance", table: "attendance", select: selectSet.attendance, filter: ["sid", id] },
        { key: "marks", table: "marks", select: selectSet.marks, filter: ["sid", id] },
        { key: "homework", table: "homework", select: selectSet.homework, filter: ["cls", profile.cls || ""], extraFilter: ["sec", profile.sec || ""] },
        { key: "fees", table: "fees", select: selectSet.fees, filter: ["sid", id] },
        { key: "exams", table: "examschedule", select: selectSet.exams, filter: ["cls", profile.cls || ""], extraFilter: ["sec", profile.sec || ""] },
      ] : [
        { key: "attendance", table: "attendance", select: selectSet.attendance, filter: ["by", id] },
        { key: "homework", table: "homework", select: selectSet.homework, filter: ["tid", id] },
        { key: "marks", table: "marks", select: selectSet.marks, filter: ["tid", id] },
        { key: "timetable", table: "timetable", select: selectSet.timetable, filter: ["tid", id] },
      ];
      const out: Record<string, Row[]> = {};
      let first = "";
      for (const config of configs) {
        const dynamicSupabase = supabase as any;
        let query = dynamicSupabase.from(config.table).select(config.select).eq(config.filter[0], config.filter[1]);
        if (config.extraFilter) query = query.eq(config.extraFilter[0], config.extraFilter[1]);
        const r = await query;
        if (r.error && !first) first = r.error.message;
        out[config.key] = r.data || [];
      }
      if (live) { setData(out); setError(first); setLoading(false); }
    })();
    return () => { live = false; };
  }, [profile, type]);
  const attendance = data.attendance || [], marks = data.marks || [];
  const present = attendance.filter((a) => safe(a.status).toLowerCase() === "present").length;
  const attendanceRate = pct(present, attendance.length);
  const avg = marks.length ? Math.round(marks.reduce((n, r) => n + (score(r) / total(r)) * 100, 0) / marks.length) : null;
  const best = marks.length ? Math.max(...marks.map((r) => Math.round((score(r) / total(r)) * 100))) : null;
  const subjectScores = useMemo(() => { const map = new Map<string, { sum: number; n: number }>(); marks.forEach((r) => { const k = safe(r.subject) || "Other"; const x = map.get(k) || { sum: 0, n: 0 }; x.sum += (score(r) / total(r)) * 100; x.n++; map.set(k, x); }); return [...map.entries()].map(([label, x]) => ({ label, value: Math.round(x.sum / x.n) })); }, [marks]);
  const trend = useMemo(() => [...marks].sort((a, b) => safe(a.date).localeCompare(safe(b.date))).slice(-8).map((r, i) => ({ label: safe(r.exam) || safe(r.subject) || `#${i + 1}`, value: Math.round((score(r) / total(r)) * 100) })), [marks]);
  return <div><button style={btn()} onClick={onBack}>← Back to profiles</button><div style={{ ...card, padding: 20, marginTop: 14, background: "linear-gradient(135deg,#4361EE,#7B6FF5)", color: "#fff" }}><div style={{ fontSize: 12, opacity: 0.8 }}>{type === "student" ? "STUDENT PROFILE" : "TEACHER PROFILE"}</div><h2 style={{ margin: "6px 0" }}>{profile.name || "Unnamed"}</h2><div style={{ fontSize: 12, opacity: 0.9 }}>{type === "student" ? `ID ${profile.sid || profile.id} · Class ${profile.cls || "—"}-${profile.sec || "—"}` : `ID ${profile.tid || profile.id} · ${profile.subject || "—"} · ${profile.phone || ""}`}</div></div>{loading ? <div style={{ ...card, padding: 30, textAlign: "center", marginTop: 14, color: C.sub }}>Loading profile analytics…</div> : <>{error && <div style={{ ...card, padding: 12, color: C.amber, marginTop: 14, fontSize: 12 }}>Some optional analytics could not be loaded: {error}</div>}<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginTop: 14 }}>{type === "student" ? <><Metric label="Attendance" value={attendanceRate == null ? "—" : `${attendanceRate}%`} hint={`${attendance.length} records`} color={C.green} /><Metric label="Average marks" value={avg == null ? "—" : `${avg}%`} color={C.accent} /><Metric label="Best score" value={best == null ? "—" : `${best}%`} color={C.purple} /><Metric label="Exam entries" value={marks.length} /><Metric label="Homework" value={(data.homework || []).length} /><Metric label="Fee records" value={(data.fees || []).length} /></> : <><Metric label="Attendance recorded" value={attendance.length} /><Metric label="Present entries" value={present} color={C.green} /><Metric label="Homework assigned" value={(data.homework || []).length} /><Metric label="Marks entered" value={marks.length} /><Metric label="Timetable entries" value={(data.timetable || []).length} /></>}</div>{type === "student" ? <><div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(280px,1fr)", gap: 14, marginTop: 14 }}><div style={{ ...card, padding: 18 }}><h3 style={{ marginTop: 0 }}>Attendance history</h3><LineChart points={attendance.slice().sort((a, b) => safe(a.date).localeCompare(safe(b.date))).slice(-14).map((a) => ({ label: safe(a.date).slice(5), value: safe(a.status).toLowerCase() === "present" ? 100 : 0 }))} /></div><div style={{ ...card, padding: 18 }}><h3 style={{ marginTop: 0 }}>Marks by subject</h3><BarChart values={subjectScores.map((x) => x.value)} labels={subjectScores.map((x) => x.label)} color={C.purple} /></div></div><div style={{ ...card, padding: 18, marginTop: 14 }}><h3 style={{ marginTop: 0 }}>Recent exam performance</h3>{trend.length ? <BarChart values={trend.map((x) => x.value)} labels={trend.map((x) => x.label)} color={C.accent} /> : <Empty text="No exam marks have been recorded for this student." />}</div><div style={{ ...card, padding: 18, marginTop: 14 }}><h3 style={{ marginTop: 0 }}>Exam records</h3>{marks.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["Exam", "Subject", "Marks", "Score", "Date"].map((h) => <th key={h} style={{ textAlign: "left", padding: 9, borderBottom: `1px solid ${C.border}`, color: C.sub }}>{h}</th>)}</tr></thead><tbody>{marks.slice().sort((a, b) => safe(b.date).localeCompare(safe(a.date))).map((r, i) => <tr key={r.id || i}><td style={{ padding: 9 }}>{r.exam || "—"}</td><td>{r.subject || "—"}</td><td>{score(r)}/{total(r)}</td><td><b>{Math.round((score(r) / total(r)) * 100)}%</b></td><td>{r.date || "—"}</td></tr>)}</tbody></table></div> : <Empty text="No exam marks recorded." />}</div></> : <><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}><div style={{ ...card, padding: 18 }}><h3 style={{ marginTop: 0 }}>Attendance records entered</h3>{attendance.length ? <BarChart values={[attendance.filter((a) => safe(a.status).toLowerCase() === "present").length, attendance.filter((a) => safe(a.status).toLowerCase() === "absent").length, attendance.filter((a) => safe(a.status).toLowerCase() === "leave").length].map((n) => attendance.length ? Math.round((n / attendance.length) * 100) : 0)} labels={["Present", "Absent", "Leave"]} color={C.green} /> : <Empty text="No attendance records are linked to this teacher." />}</div><div style={{ ...card, padding: 18 }}><h3 style={{ marginTop: 0 }}>Teaching activity</h3><BarChart values={[(data.homework || []).length, (data.marks || []).length, (data.timetable || []).length]} labels={["Homework", "Marks", "Timetable"]} suffix="" /></div></div></>}</>}</div>;
}
