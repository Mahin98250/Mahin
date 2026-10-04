import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lg/supabase";
import { hasInstitutePermission } from "@/lg/tenant";
import { compressFile } from "@/lg/fileCompression";
import { enqueuePdfCompressionJob } from "@/lg/pdfCompressionJobs";

type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  access_standards: string[];
};

type Material = {
  id: string;
  title?: string;
  name?: string;
  folder_id: string | null;
  storage_path?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  created_at: string;
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPT = ".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg";
const STANDARDS = ["9", "10", "11", "12"];

function bytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function sameText(a: unknown, b: unknown) {
  return (
    String(a ?? "")
      .trim()
      .toLowerCase() ===
    String(b ?? "")
      .trim()
      .toLowerCase()
  );
}

function accessLabel(values: string[]) {
  const selected = STANDARDS.filter((value) => values.includes(value));
  return selected.length
    ? selected.map((value) => `Standard ${value}`).join(", ")
    : "No students selected";
}

export function MaterialsDrive() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<Material[]>([]);
  const [current, setCurrent] = useState<Folder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderAccess, setFolderAccess] = useState<string[]>([]);
  const [editingAccess, setEditingAccess] = useState<Folder | null>(null);
  const [editingAccessValues, setEditingAccessValues] = useState<string[]>([]);
  const [rename, setRename] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const currentChildren = useMemo(
    () => folders.filter((folder) => folder.parent_id === (current?.id ?? null)),
    [folders, current],
  );
  const currentFiles = useMemo(
    () => files.filter((file) => file.folder_id === (current?.id ?? null)),
    [files, current],
  );
  const breadcrumbs = useMemo(() => {
    const result: Folder[] = [];
    let id = current?.id;
    while (id) {
      const folder = folders.find((item) => item.id === id);
      if (!folder) break;
      result.unshift(folder);
      id = folder.parent_id ?? undefined;
    }
    return result;
  }, [current, folders]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [folderResult, materialResult] = await Promise.all([
      supabase
        .from("material_folders")
        .select("id,name,parent_id,created_at,access_standards")
        .order("name"),
      supabase
        .from("materials")
        .select("id,title,name,folder_id,storage_path,file_size,mime_type,created_at")
        .order("created_at", { ascending: false }),
    ]);

    const errors: string[] = [];
    if (folderResult.error) errors.push(`Folders: ${folderResult.error.message}`);
    else setFolders((folderResult.data || []) as Folder[]);
    if (materialResult.error) errors.push(`Files: ${materialResult.error.message}`);
    else setFiles((materialResult.data || []) as Material[]);

    if (
      folderResult.data &&
      current &&
      !folderResult.data.some((folder) => folder.id === current.id)
    ) {
      setCurrent(null);
    }
    setError(errors.join(" • "));
    setLoading(false);
  }, [current]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleStandard(value: string, setter: (values: string[]) => void, values: string[]) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    if (!folderAccess.length) {
      setError("Select at least one standard that can access this folder.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const existing = folders.find(
        (folder) => folder.parent_id === (current?.id ?? null) && sameText(folder.name, name),
      );
      if (existing) throw new Error("A folder with this name already exists here.");

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user)
        throw new Error("Your administrator session has expired. Please sign in again.");

      if (!(await hasInstitutePermission(instituteId, "materials.manage"))) throw new Error("Administrator lacks materials.manage for this institute workspace.");
      const { error: insertError } = await supabase.from("material_folders").insert({
        name,
        parent_id: current?.id ?? null,
        created_by: authData.user.id,
        access_standards: STANDARDS.filter((value) => folderAccess.includes(value)),
      });
      if (insertError) throw insertError;

      setFolderName("");
      setFolderAccess([]);
      setNewFolder(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create the folder.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAccess() {
    if (!editingAccess || !editingAccessValues.length) {
      setError("Select at least one standard that can access this folder.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("material_folders")
        .update({
          access_standards: STANDARDS.filter((value) => editingAccessValues.includes(value)),
        })
        .eq("id", editingAccess.id);
      if (updateError) throw updateError;
      setEditingAccess(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update folder access.");
    } finally {
      setBusy(false);
    }
  }

  async function renameFolder() {
    if (!rename || !renameValue.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("material_folders")
        .update({ name: renameValue.trim() })
        .eq("id", rename.id);
      if (updateError) throw updateError;
      setRename(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to rename the folder.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(folder: Folder) {
    if (!window.confirm(`Delete “${folder.name}” and everything inside it?`)) return;
    setBusy(true);
    setError("");
    try {
      const { data: allFolders, error: folderReadError } = await supabase
        .from("material_folders")
        .select("id,parent_id");
      if (folderReadError) throw folderReadError;

      const ids = new Set<string>([folder.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of allFolders || []) {
          if (item.parent_id && ids.has(item.parent_id) && !ids.has(item.id)) {
            ids.add(item.id);
            changed = true;
          }
        }
      }

      const targets = files.filter((file) => file.folder_id && ids.has(file.folder_id));
      const paths = targets.map((file) => file.storage_path).filter(Boolean) as string[];
      if (paths.length) {
        const { error: storageError } = await supabase.storage.from("materials").remove(paths);
        if (storageError) throw storageError;
      }

      const { error: materialError } = await supabase
        .from("materials")
        .delete()
        .in("folder_id", [...ids]);
      if (materialError) throw materialError;
      const { error: folderError } = await supabase
        .from("material_folders")
        .delete()
        .in("id", [...ids]);
      if (folderError) throw folderError;

      if (current && ids.has(current.id)) setCurrent(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete the folder.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!current) {
      setError("Open the folder where this material should be stored first.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("File is larger than the 50 MB limit.");
      return;
    }

    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `institute/${instituteId}/materials/${crypto.randomUUID()}.${ext}`;
    setBusy(true);
    setError("");
    try {
      const compressed = await compressFile(file);
      const uploadFile = compressed.file;
      const { error: uploadError } = await supabase.storage
        .from("materials")
        .upload(path, uploadFile, { upsert: false, contentType: uploadFile.type || file.type || undefined });
      if (uploadError) throw uploadError;

      if (!(await hasInstitutePermission(instituteId, "materials.manage"))) throw new Error("Administrator lacks materials.manage for this institute workspace.");
      const { error: insertError } = await supabase.from("materials").insert({
        title: safe,
        name: safe,
        folder_id: current.id,
        storage_path: path,
        file_size: uploadFile.size,
        mime_type: uploadFile.type || file.type || null,
      });
      if (insertError) {
        await supabase.storage.from("materials").remove([path]);
        throw insertError;
      }
      if (/\.pdf$/i.test(path)) {
        void enqueuePdfCompressionJob("materials", path).catch((queueError) =>
          console.warn("PDF compression queue unavailable; original upload kept.", queueError),
        );
      }
      await load();
    } catch (e) {
      await supabase.storage
        .from("materials")
        .remove([path])
        .catch(() => undefined);
      setError(e instanceof Error ? e.message : "Unable to upload the material.");
    } finally {
      setBusy(false);
    }
  }

  async function download(file: Material) {
    if (!file.storage_path) {
      setError("This material does not have a stored file yet.");
      return;
    }
    try {
      const { data, error: downloadError } = await supabase.storage
        .from("materials")
        .download(file.storage_path);
      if (downloadError) throw downloadError;
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name || file.title || "material";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download the material.");
    }
  }

  async function deleteFile(file: Material) {
    if (!window.confirm(`Delete “${file.name || file.title}”?`)) return;
    setBusy(true);
    setError("");
    try {
      if (file.storage_path) {
        const { error: storageError } = await supabase.storage
          .from("materials")
          .remove([file.storage_path]);
        if (storageError) throw storageError;
      }
      if (!(await hasInstitutePermission(instituteId, "materials.manage"))) throw new Error("Administrator lacks materials.manage for this institute workspace.");
      const { error: deleteError } = await supabase.from("materials").delete().eq("id", file.id);
      if (deleteError) throw deleteError;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete the material.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <div style={header}>
        <div>
          <h2 style={{ margin: 0 }}>📚 Study Materials</h2>
          <p style={sub}>
            Create folders and choose exactly which standards can access them. Batch, section, and
            subject are not used for access.
          </p>
        </div>
        <div style={actions}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setFolderName("");
              setFolderAccess(current?.access_standards || []);
              setNewFolder(true);
            }}
            style={btn}
          >
            📁 New Folder
          </button>
          <label
            style={{
              ...btn,
              cursor: busy ? "wait" : "pointer",
              opacity: busy || !current ? 0.6 : 1,
            }}
          >
            ⬆ Upload
            <input
              hidden
              disabled={busy || !current}
              type="file"
              accept={ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void load()} style={btn}>
            ↻
          </button>
        </div>
      </div>

      <div style={crumbRow}>
        <button type="button" onClick={() => setCurrent(null)} style={crumb}>
          My Drive
        </button>
        {breadcrumbs.map((folder) => (
          <span key={folder.id}>
            {" "}
            /{" "}
            <button type="button" onClick={() => setCurrent(folder)} style={crumb}>
              {folder.name}
            </button>
          </span>
        ))}
      </div>

      {current && (
        <div style={hint}>
          <b>{current.name}</b>
          <span> · Access: {accessLabel(current.access_standards)}</span>
          <span style={{ marginLeft: 8, color: "#64748B" }}>
            Files inside inherit this folder's access.
          </span>
        </div>
      )}
      {error && <div style={errorBox}>{error}</div>}

      <div style={grid}>
        {loading ? (
          <div style={empty}>Loading…</div>
        ) : (
          <>
            {currentChildren.map((folder) => (
              <div key={folder.id} style={item}>
                <button type="button" onClick={() => setCurrent(folder)} style={icon}>
                  📁
                </button>
                <button type="button" onClick={() => setCurrent(folder)} style={folderMain}>
                  <b style={ellipsis}>{folder.name}</b>
                  <span style={meta}>{accessLabel(folder.access_standards)}</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  title="Access"
                  onClick={() => {
                    setEditingAccess(folder);
                    setEditingAccessValues(folder.access_standards || []);
                  }}
                  style={more}
                >
                  🔐
                </button>
                <button
                  type="button"
                  disabled={busy}
                  title="Rename"
                  onClick={() => {
                    setRename(folder);
                    setRenameValue(folder.name);
                  }}
                  style={more}
                >
                  ✎
                </button>
                <button
                  type="button"
                  disabled={busy}
                  title="Delete"
                  onClick={() => void deleteFolder(folder)}
                  style={more}
                >
                  🗑
                </button>
              </div>
            ))}
            {currentFiles.map((file) => (
              <div key={file.id} style={item}>
                <div style={{ ...icon, fontSize: 26 }}>
                  {file.mime_type?.includes("pdf") ? "📄" : "📎"}
                </div>
                <div style={folderMain}>
                  <b style={ellipsis}>{file.name || file.title || "Untitled"}</b>
                  <span style={meta}>{bytes(file.file_size)}</span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  title="Download"
                  onClick={() => void download(file)}
                  style={more}
                >
                  ⬇
                </button>
                <button
                  type="button"
                  disabled={busy}
                  title="Delete"
                  onClick={() => void deleteFile(file)}
                  style={more}
                >
                  🗑
                </button>
              </div>
            ))}
            {!currentChildren.length && !currentFiles.length && (
              <div style={{ ...empty, gridColumn: "1/-1" }}>
                {current
                  ? "This folder is empty. Upload a file here or create a subfolder."
                  : "Create a folder to start your study-material library."}
              </div>
            )}
          </>
        )}
      </div>

      {newFolder && (
        <div style={overlay}>
          <div style={dialog}>
            <h3 style={{ marginTop: 0 }}>New Folder</h3>
            <input
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Folder name"
              style={input}
            />
            <div style={{ marginTop: 16, fontWeight: 800 }}>Who can access this folder?</div>
            <div style={standardGrid}>
              {STANDARDS.map((standard) => (
                <label key={standard} style={check}>
                  <input
                    type="checkbox"
                    checked={folderAccess.includes(standard)}
                    onChange={() => toggleStandard(standard, setFolderAccess, folderAccess)}
                  />{" "}
                  Standard {standard}
                </label>
              ))}
            </div>
            <p style={note}>
              All sections and batches inside the selected standard share the same access.
            </p>
            <div style={dialogActions}>
              <button type="button" onClick={() => setNewFolder(false)} style={cancel}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void createFolder()} style={btn}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {editingAccess && (
        <div style={overlay}>
          <div style={dialog}>
            <h3 style={{ marginTop: 0 }}>Folder Access</h3>
            <p style={sub}>Who can access “{editingAccess.name}”?</p>
            <div style={standardGrid}>
              {STANDARDS.map((standard) => (
                <label key={standard} style={check}>
                  <input
                    type="checkbox"
                    checked={editingAccessValues.includes(standard)}
                    onChange={() =>
                      toggleStandard(standard, setEditingAccessValues, editingAccessValues)
                    }
                  />{" "}
                  Standard {standard}
                </label>
              ))}
            </div>
            <p style={note}>
              Changing this applies to the folder and its files. Nested folders inherit access from
              this folder unless they have their own selected standards.
            </p>
            <div style={dialogActions}>
              <button type="button" onClick={() => setEditingAccess(null)} style={cancel}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void saveAccess()} style={btn}>
                Save Access
              </button>
            </div>
          </div>
        </div>
      )}

      {rename && (
        <div style={overlay}>
          <div style={dialog}>
            <h3 style={{ marginTop: 0 }}>Rename Folder</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              style={input}
            />
            <div style={dialogActions}>
              <button type="button" onClick={() => setRename(null)} style={cancel}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void renameFolder()} style={btn}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@media(max-width:650px){.drive-grid{grid-template-columns:1fr!important}.drive-wrap{padding:16px!important}}`}</style>
    </div>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100%",
  padding: 28,
  fontFamily: "Poppins,system-ui,sans-serif",
  color: "#0F1B3D",
};
const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "center",
  marginBottom: 18,
};
const actions: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};
const btn: React.CSSProperties = {
  border: 0,
  borderRadius: 11,
  padding: "10px 14px",
  background: "#4361EE",
  color: "#fff",
  fontWeight: 750,
  cursor: "pointer",
};
const sub: React.CSSProperties = {
  margin: "5px 0 0",
  color: "#64748B",
  fontSize: 13,
  lineHeight: 1.5,
};
const crumbRow: React.CSSProperties = {
  display: "flex",
  gap: 7,
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: 14,
  fontSize: 13,
};
const crumb: React.CSSProperties = {
  border: 0,
  background: "transparent",
  color: "#4361EE",
  fontWeight: 700,
  cursor: "pointer",
  padding: 2,
};
const hint: React.CSSProperties = {
  background: "#EEF2FF",
  border: "1px solid #C7D2FE",
  color: "#3730A3",
  borderRadius: 14,
  padding: "10px 12px",
  marginBottom: 14,
  fontSize: 12,
};
const errorBox: React.CSSProperties = {
  background: "#FEF2F2",
  color: "#B91C1C",
  border: "1px solid #FECACA",
  padding: 12,
  borderRadius: 12,
  marginBottom: 14,
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
  gap: 12,
};
const item: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: 14,
  background: "#fff",
  border: "1px solid #E2E8F0",
  borderRadius: 16,
  boxShadow: "0 4px 18px rgba(15,27,61,.06)",
};
const icon: React.CSSProperties = {
  border: 0,
  background: "transparent",
  cursor: "pointer",
  fontSize: 30,
  padding: 0,
};
const folderMain: React.CSSProperties = {
  minWidth: 0,
  flex: 1,
  border: 0,
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
  padding: 0,
};
const ellipsis: React.CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const meta: React.CSSProperties = {
  display: "block",
  color: "#64748B",
  fontSize: 11,
  marginTop: 3,
};
const more: React.CSSProperties = {
  border: 0,
  background: "transparent",
  cursor: "pointer",
  padding: 7,
  borderRadius: 8,
};
const empty: React.CSSProperties = {
  padding: 50,
  textAlign: "center",
  color: "#64748B",
  background: "#fff",
  border: "1px dashed #CBD5E1",
  borderRadius: 16,
};
const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  background: "rgba(15,27,61,.45)",
  display: "grid",
  placeItems: "center",
  padding: 16,
};
const dialog: React.CSSProperties = {
  width: "min(460px,100%)",
  background: "#fff",
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 24px 70px rgba(15,27,61,.25)",
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #CBD5E1",
  borderRadius: 11,
  padding: "12px 13px",
  outline: "none",
};
const standardGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 9,
  marginTop: 10,
};
const check: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: 10,
  border: "1px solid #E2E8F0",
  borderRadius: 10,
  cursor: "pointer",
};
const note: React.CSSProperties = { color: "#64748B", fontSize: 12, lineHeight: 1.5 };
const cancel: React.CSSProperties = {
  border: "1px solid #CBD5E1",
  borderRadius: 11,
  padding: "10px 14px",
  background: "#fff",
  cursor: "pointer",
};
const dialogActions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 18,
};
