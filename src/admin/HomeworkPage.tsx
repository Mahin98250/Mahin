import { useEffect, useMemo, useState } from "react";
import { delR, gdb, C, subjectsForClasses } from "@/lg/data";
import { supabase } from "@/lg/supabase";
import { compressFile } from "@/lg/fileCompression";
import { enqueuePdfCompressionJob } from "@/lg/pdfCompressionJobs";
import { getCurrentInstituteContext, hasInstitutePermission } from "@/lg/tenant";

type Row = Record<string, any>;
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export default function HomeworkPage() {
  const [homework, setHomework] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [teachers, setTeachers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ batchId: "", teacherId: "", subject: "", desc: "", given: new Date().toISOString().slice(0, 10), due: "", pdfName: "" });

  const load = async () => {
    setLoading(true); setError("");
    try {
      const context = await getCurrentInstituteContext();
      const instituteId = context.membership?.institute_id;
      if (!instituteId) throw new Error("An active institute workspace must be selected.");
      if (!(await hasInstitutePermission(instituteId, "homework.read"))) throw new Error("Administrator lacks homework.read for this institute workspace.");
      const [hw, bs, ts] = await Promise.all([
        supabase.from("homework").select("id,tid,cls,sec,batch_id,subject,desc,given,due,completedby,pdfname,storage_path,file_size,mime_type,created_at").eq("institute_id", instituteId).order("created_at", { ascending: false }),
        gdb("batches"),
        gdb("teachers"),
      ]);
      if (hw.error) throw hw.error;
      setHomework(hw.data || []); setBatches((bs || []).filter((b: Row) => b.status !== "inactive")); setTeachers((ts || []).filter((t: Row) => t.status !== "inactive"));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load homework."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selectedBatch = batches.find((b) => String(b.id) === String(form.batchId));
  const subjects = useMemo(() => subjectsForClasses(selectedBatch?.cls ? [selectedBatch.cls] : []), [selectedBatch?.cls]);
  const handlePdf = (selected: File | undefined) => {
    setError(""); if (!selected) return;
    if (selected.type !== "application/pdf") { setError("Only PDF files are allowed."); return; }
    if (selected.size > MAX_PDF_BYTES) { setError("PDF is too large. Maximum size is 50 MB."); return; }
    setFile(selected); setForm((f) => ({ ...f, pdfName: selected.name }));
  };
  const save = async () => {
    setError("");
    if (!form.batchId || !form.subject || !form.desc.trim() || !form.due) { setError("Batch, subject, description and due date are required."); return; }
    if (!selectedBatch) { setError("Please select a valid batch."); return; }
    setSaving(true); setProcessing(""); let storagePath = "";
    const id = `hw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      const context = await getCurrentInstituteContext();
      const instituteId = context.membership?.institute_id;
      if (!instituteId) throw new Error("An active institute workspace must be selected.");
      if (!(await hasInstitutePermission(instituteId, "homework.manage"))) throw new Error("Administrator lacks homework.manage for this institute workspace.");
      let uploadFile = file;
      if (file) {
        const optimized = await compressFile(file, setProcessing);
        uploadFile = optimized.file;
        if (optimized.optimized) setProcessing(`Optimized ${optimized.savingsPercent}% smaller (${(optimized.originalSize / 1048576).toFixed(1)} → ${(optimized.optimizedSize / 1048576).toFixed(1)} MB)`);
      }
      if (uploadFile) {
        storagePath = `institute/${instituteId}/homework/${selectedBatch.id}/${id}-${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: uploadError } = await supabase.storage.from("homework").upload(storagePath, uploadFile, { upsert: false, contentType: "application/pdf" });
        if (uploadError) throw uploadError;
      }
      const { error: insertError } = await supabase.from("homework").insert({ institute_id: instituteId, id, cls: String(selectedBatch.cls || ""), sec: String(selectedBatch.sec || ""), batch_id: selectedBatch.id, subject: form.subject, desc: form.desc.trim(), given: form.given, due: form.due, tid: form.teacherId || null, completedby: [], pdfname: form.pdfName || null, pdfdata: null, storage_path: storagePath || null, file_size: uploadFile?.size || null, mime_type: uploadFile ? "application/pdf" : null });
      if (insertError) throw insertError;
      if (storagePath && /\.pdf$/i.test(storagePath)) {
        void enqueuePdfCompressionJob("homework", storagePath).catch((queueError) =>
          console.warn("PDF compression queue unavailable; original upload kept.", queueError),
        );
      }
      setFile(null); setForm({ batchId: "", teacherId: "", subject: "", desc: "", given: new Date().toISOString().slice(0, 10), due: "", pdfName: "" }); await load();
    } catch (e) {
      if (storagePath) await supabase.storage.from("homework").remove([storagePath]);
      setError(e instanceof Error ? e.message : "Unable to create homework.");
    } finally { setSaving(false); setProcessing(""); }
  };
  const remove = async (row: Row) => {
    if (!window.confirm("Delete this homework?")) return;
    try {
      const context = await getCurrentInstituteContext();
      const instituteId = context.membership?.institute_id;
      if (!instituteId) throw new Error("An active institute workspace must be selected.");
      if (!(await hasInstitutePermission(instituteId, "homework.manage"))) throw new Error("Administrator lacks homework.manage for this institute workspace.");
      if (row.storage_path) {
        const { error: storageError } = await supabase.storage.from("homework").remove([row.storage_path]);
        if (storageError) throw storageError;
      }
      await delR("homework", row.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete homework.");
    }
  };

  return <div className="admin-homework-page" style={{ padding: "clamp(14px,3vw,28px)", maxWidth: 1100, margin: "0 auto", fontFamily: "Poppins,system-ui,sans-serif", color: C.text, boxSizing: "border-box", width: "100%", overflowX: "hidden" }}>
    <style>{`@media(max-width:640px){.homework-header{align-items:flex-start!important;flex-direction:column!important}.homework-header button{width:100%}.homework-form{padding:15px!important}.homework-form-grid{grid-template-columns:1fr!important}.homework-submit{width:100%;min-height:46px}.homework-list{padding:15px!important}.homework-row{flex-direction:column!important;align-items:stretch!important}.homework-row button{width:100%;min-height:42px}.homework-description{overflow-wrap:anywhere}.homework-file{width:100%;box-sizing:border-box}}`}</style>
    <div className="homework-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12 }}><div style={{ minWidth: 0 }}><h2 style={{ margin: 0, fontSize: 20 }}>Homework 📝</h2><div style={{ color: C.sub, fontSize: 13, marginTop: 3 }}>Admin can assign homework to any batch and securely attach a PDF. PDFs are optimized automatically before upload.</div></div><button onClick={() => void load()} style={{ border: 0, borderRadius: 10, padding: "9px 13px", minHeight: 42, background: C.light, color: C.accent, fontWeight: 800, cursor: "pointer" }}>↻ Refresh</button></div>
    {error && <div style={{ background: "#FFF5F5", border: `1px solid ${C.red}33`, borderLeft: `4px solid ${C.red}`, borderRadius: 12, padding: 12, marginBottom: 14, color: C.red, fontSize: 13, overflowWrap: "anywhere" }}>{error}</div>}
    {processing && <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 12, padding: 10, marginBottom: 14, color: C.accent, fontSize: 12, fontWeight: 700 }}>{processing}</div>}
    <div className="homework-form" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 18, padding: 20, marginBottom: 18, boxShadow: "0 4px 18px rgba(15,27,61,.06)" }}>
      <div style={{ fontWeight: 800, marginBottom: 14 }}>Create Homework</div>
      <div className="homework-form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>Batch<select value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value, subject: "" })} style={{ display: "block", width: "100%", minHeight: 44, marginTop: 6, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.light }}><option value="">Select batch…</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name || `Class ${b.cls}-${b.sec}`}</option>)}</select></label>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>Teacher (optional)<select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} style={{ display: "block", width: "100%", minHeight: 44, marginTop: 6, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.light }}><option value="">Admin / no teacher</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name || t.tid || t.id}</option>)}</select></label>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>Subject<select value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={{ display: "block", width: "100%", minHeight: 44, marginTop: 6, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.light }}><option value="">Select subject…</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>Due date<input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} style={{ display: "block", width: "100%", minHeight: 44, marginTop: 6, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.light }} /></label>
      </div>
      <label style={{ display: "block", marginTop: 12, fontSize: 12, fontWeight: 700, color: C.sub }}>Description<textarea value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="Homework instructions…" style={{ display: "block", width: "100%", boxSizing: "border-box", minHeight: 90, marginTop: 6, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.light, resize: "vertical" }} /></label>
      <label className="homework-file" style={{ display: "block", marginTop: 12, fontSize: 12, fontWeight: 700, color: C.sub }}>Attach PDF (optional)<input type="file" accept="application/pdf,.pdf" onChange={(e) => handlePdf(e.target.files?.[0])} style={{ display: "block", maxWidth: "100%", marginTop: 7 }} />{form.pdfName && <span style={{ display: "block", marginTop: 5, color: C.green, overflowWrap: "anywhere" }}>✓ {form.pdfName}</span>}</label>
      <button className="homework-submit" disabled={saving} onClick={() => void save()} style={{ marginTop: 16, border: 0, borderRadius: 11, padding: "11px 18px", background: C.accent, color: "#fff", fontWeight: 800, cursor: saving ? "wait" : "pointer", opacity: saving ? .65 : 1 }}>{saving ? (processing || "Saving…") : "Assign Homework"}</button>
    </div>
    <div className="homework-list" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 18, padding: 20 }}><div style={{ fontWeight: 800, marginBottom: 12 }}>Existing Homework ({homework.length})</div>{loading ? <div style={{ color: C.sub }}>Loading…</div> : homework.length === 0 ? <div style={{ color: C.sub }}>No homework assigned yet.</div> : homework.map((h) => <div className="homework-row" key={h.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 750, overflowWrap: "anywhere" }}>{h.subject} · Class {h.cls}-{h.sec}</div><div className="homework-description" style={{ fontSize: 12, color: C.sub }}>{h.desc}</div><div style={{ fontSize: 11, color: C.sub, marginTop: 4, overflowWrap: "anywhere" }}>Due: {h.due}{h.pdfname ? ` · 📄 ${h.pdfname}` : ""}</div></div><button onClick={() => void remove(h)} style={{ alignSelf: "center", border: 0, borderRadius: 9, padding: "7px 10px", minHeight: 42, background: "#FEE2E2", color: C.red, cursor: "pointer" }}>🗑 Delete</button></div>)}</div>
  </div>;
}
