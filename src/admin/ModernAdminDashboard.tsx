import { useEffect, useState } from "react";
import { supabase } from "@/lg/supabase";
import { hasInstitutePermission } from "@/lg/tenant";
import { useInstituteWorkspace } from "@/lg/tenant-context";
import "@/admin/modern-admin-dashboard.css";

type AdminUser = { name: string };
type Props = { user: AdminUser; onNavigate: (label: string) => void };

type Counts = {
  students: number;
  teachers: number;
  batches: number;
  homework: number;
  tests: number;
  attendance: number;
  fees: number;
  announcements: number;
};

const EMPTY: Counts = { students: 0, teachers: 0, batches: 0, homework: 0, tests: 0, attendance: 0, fees: 0, announcements: 0 };

async function count(table: string, instituteId: string) {
  const permission = table === "students" ? "students.read" : table === "teachers" ? "teachers.read" : table === "batches" ? "academics.read" : table === "homework" ? "homework.read" : table === "tests" ? "assessments.read" : table === "attendance" ? "attendance.read" : table === "fees" ? "fees.read" : "announcements.read";
  if (!(await hasInstitutePermission(instituteId, permission))) return 0;
  const { count: value, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("institute_id", instituteId);
  if (error) throw error;
  return value || 0;
}

export function ModernAdminDashboard({ user, onNavigate }: Props) {
  const { instituteId, tenant } = useInstituteWorkspace();
  const workspaceName = tenant?.display_name || tenant?.name || "Institute";
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      setError("");
      if (!instituteId) {
        setError("An active institute workspace must be selected.");
        setLoading(false);
        return;
      }
      const keys: Array<keyof Counts> = ["students", "teachers", "batches", "homework", "tests", "attendance", "fees", "announcements"];
      const tables = ["students", "teachers", "batches", "homework", "tests", "attendance", "fees", "announcements"];
      const results = await Promise.allSettled(tables.map((table) => count(table, instituteId)));
      if (!live) return;
      const next = { ...EMPTY };
      const failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") next[keys[index]] = result.value;
        else failed.push(keys[index]);
      });
      setCounts(next);
      if (failed.length) setError(`Some overview metrics could not be loaded: ${failed.join(", ")}.`);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [instituteId]);

  const cards = [
    ["Students", "🎓", counts.students, "People enrolled"],
    ["Teachers", "👨‍🏫", counts.teachers, "Teaching staff"],
    ["Batches", "▦", counts.batches, "Active groups"],
    ["Homework", "✎", counts.homework, "Assigned work"],
    ["Tests", "▤", counts.tests, "Scheduled tests"],
    ["Attendance", "✓", counts.attendance, "Attendance records"],
    ["Fees", "₹", counts.fees, "Fee records"],
    ["Announcements", "📢", counts.announcements, "Published notices"],
  ] as const;

  const quick = [
    ["🎓", "Manage Students", "Add, edit and review student records", "Students"],
    ["👨‍🏫", "Manage Teachers", "Teacher accounts and subjects", "Teachers"],
    ["▦", "Batches & Timetable", "Classes, subjects and timetable", "Batches & Timetable"],
    ["✓", "Attendance", "Review attendance activity", "Attendance"],
    ["🏆", "Student Results", "Enter and review test results", "Student Results"],
    ["📚", "Study Materials", "Manage folders and PDFs", "Study Materials"],
  ] as const;

  return (
    <div className="modern-dashboard">
      <section className="modern-dashboard-hero">
        <div className="modern-dashboard-hero-copy">
          <span className="modern-dashboard-eyebrow">{workspaceName.toUpperCase()} · ADMIN CONTROL CENTER</span>
          <h2>Good to see you, {user.name || "Admin"}. 👋</h2>
          <p>Everything important about your institute, in one simple control center.</p>
        </div>
        <div className="modern-dashboard-hero-orb" aria-hidden="true"><span>LG</span></div>
      </section>

      {error && <div className="modern-dashboard-error" role="alert">{error}</div>}

      <section className="modern-dashboard-section">
        <div className="modern-dashboard-section-head"><div><span className="modern-dashboard-kicker">AT A GLANCE</span><h3>Institute overview</h3></div><span className="modern-dashboard-live">● Live data</span></div>
        <div className="modern-dashboard-stat-grid">
          {cards.map(([title, icon, value, hint]) => (
            <div className="modern-dashboard-stat" key={title}>
              <div className="modern-dashboard-stat-icon">{icon}</div>
              <div className="modern-dashboard-stat-main"><span>{title}</span><strong>{loading ? "—" : value}</strong><small>{hint}</small></div>
            </div>
          ))}
        </div>
      </section>

      <section className="modern-dashboard-section">
        <div className="modern-dashboard-section-head"><div><span className="modern-dashboard-kicker">SHORTCUTS</span><h3>Quick management</h3></div><button className="modern-dashboard-text-button" onClick={() => onNavigate("Students")}>Open People →</button></div>
        <div className="modern-dashboard-quick-grid">
          {quick.map(([icon, title, hint, target]) => (
            <button type="button" className="modern-dashboard-quick" key={title} onClick={() => onNavigate(target)}>
              <span className="modern-dashboard-quick-icon">{icon}</span>
              <span><strong>{title}</strong><small>{hint}</small></span>
              <b>→</b>
            </button>
          ))}
        </div>
      </section>

      <section className="modern-dashboard-bottom-grid">
        <div className="modern-dashboard-panel">
          <div className="modern-dashboard-panel-title"><span>⚡</span><div><strong>Admin at a glance</strong><small>Common tasks are one tap away.</small></div></div>
          <div className="modern-dashboard-mini-actions">
            <button onClick={() => onNavigate("User Accounts")}>🔐 User Accounts</button>
            <button onClick={() => onNavigate("Search Profiles")}>⌕ Search Profiles</button>
            <button onClick={() => onNavigate("Analytics")}>↗ Analytics</button>
            <button onClick={() => onNavigate("Leave Requests")}>☷ Leave Requests</button>
          </div>
        </div>
        <div className="modern-dashboard-panel modern-dashboard-principle">
          <span className="modern-dashboard-kicker">DESIGN PRINCIPLE</span>
          <strong>Simple on the surface. Powerful underneath.</strong>
          <p>The new admin interface keeps your existing data, permissions and workflows while replacing the old navigation experience.</p>
        </div>
      </section>
    </div>
  );
}
