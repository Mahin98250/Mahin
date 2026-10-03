import { useEffect, useRef, useState } from "react";
import PlatformOwnerLogin from "@/platform/PlatformOwnerLogin";
import InstituteOnboardingWizard from "@/platform/InstituteOnboardingWizard";
import {
  getPlatformInstituteOverview,
  getPlatformInstituteStatusCounts,
  invalidatePlatformInstituteStatusCounts,
  listPlatformInstitutes,
  type PlatformInstitute,
  type PlatformInstituteCursor,
  type PlatformInstituteOverview,
  type PlatformStorageOverview,
  getPlatformStorageOverview,
  type PlatformSystemHealth,
  getPlatformSystemHealth,
  type PlatformAnalyticsOverview,
  getPlatformAnalytics,
  type PlatformAuditOverview,
  getPlatformAuditActivity,
  type PlatformDomain,
  getPlatformDomains,
  type PlatformSecurityOverview,
  getPlatformSecurityOverview,
  registerPlatformDomain,
  verifyPlatformDomain,
  setPlatformDomainTls,
  setPlatformPrimaryDomain,
  disablePlatformDomain,
} from "@/platform/platform-tenant-data";
import { supabase } from "@/lg/supabase";

type PlatformSettings = { product_name: string; legal_name: string; public_website_url: string; default_app_domain: string; support_email: string; default_timezone: string; settings: Record<string, unknown> };
import "./owner-liquid-glass.css";

const shell = {
  minHeight: "100vh",
  background: "#f5f7fb",
  color: "#14213d",
  fontFamily: "Poppins,system-ui,sans-serif",
};

const button = (primary = true) => ({
  border: 0,
  borderRadius: 11,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
  background: primary ? "#4f46e5" : "#e8ecf5",
  color: primary ? "#fff" : "#24324a",
});

type OwnerNavItem = { key: string; icon: string; label: string };

type OwnerNavGroup = { group: string; items: OwnerNavItem[] };

const OWNER_NAV: OwnerNavGroup[] = [
  { group: "Overview", items: [
    { key: "dashboard", icon: "⌂", label: "Dashboard" },
    { key: "institutes", icon: "🏫", label: "Institutes" },
  ]},
  { group: "Platform", items: [
    { key: "analytics", icon: "↗", label: "Analytics" },
    { key: "storage", icon: "▣", label: "Storage" },
    { key: "domains", icon: "◎", label: "Domains" },
  ]},
  { group: "Management", items: [
    { key: "activity", icon: "☷", label: "Activity & Audit" },
    { key: "health", icon: "♥", label: "System Health" },
  ]},
  { group: "Configuration", items: [
    { key: "settings", icon: "⚙", label: "Platform Settings" },
    { key: "security", icon: "🔐", label: "Security" },
  ]},
] as const;

function formatBytes(bytes: number | null) {
  if (bytes == null) return "Not configured";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = -1;
  do { value /= 1024; index += 1; } while (value >= 1024 && index < units.length - 1);
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2) + " " + units[index];
}

function errorIsUnauthorized(error: unknown) {
  return Number((error as { status?: number } | null)?.status) === 401 ||
    /jwt|unauthorized/i.test(String((error as { message?: string } | null)?.message || ""));
}

function formatPercent(value: number) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "0%";
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function statusTone(status: string) {
  if (status === "active") return { background: "#ecfdf3", color: "#067647" };
  if (status === "trial") return { background: "#eff8ff", color: "#175cd3" };
  if (status === "suspended") return { background: "#fffaeb", color: "#b54708" };
  if (status === "archived") return { background: "#f2f4f7", color: "#475467" };
  return { background: "#fef3f2", color: "#b42318" };
}

export default function PlatformOwnerControlPlane() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [institutes, setInstitutes] = useState<PlatformInstitute[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState<PlatformInstituteCursor | null>(null);
  const [nextCursor, setNextCursor] = useState<PlatformInstituteCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "trial" | "active" | "suspended" | "archived">("all");
  const [loading, setLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PlatformInstitute | null>(null);
  const [overview, setOverview] = useState<PlatformInstituteOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsWorking, setSettingsWorking] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [storageOverview, setStorageOverview] = useState<PlatformStorageOverview | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [systemHealth, setSystemHealth] = useState<PlatformSystemHealth | null>(null);
  const [systemHealthLoading, setSystemHealthLoading] = useState(false);
  const [analyticsOverview, setAnalyticsOverview] = useState<PlatformAnalyticsOverview | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [auditOverview, setAuditOverview] = useState<PlatformAuditOverview | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditDays, setAuditDays] = useState(30);
  const [auditCategory, setAuditCategory] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [domains, setDomains] = useState<PlatformDomain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainWorking, setDomainWorking] = useState("");
  const [domainOpen, setDomainOpen] = useState(false);
  const [domainInstitute, setDomainInstitute] = useState("");
  const [domainHostname, setDomainHostname] = useState("");
  const [domainToken, setDomainToken] = useState<string | null>(null);
  const [securityOverview, setSecurityOverview] = useState<PlatformSecurityOverview | null>(null);
  const [securityFactors, setSecurityFactors] = useState<{ id: string; factor_type: string; status: string; friendly_name: string | null }[]>([]);
  const [securityAal, setSecurityAal] = useState<{ current: string | null; next: string | null }>({ current: null, next: null });
  const [securityLoading, setSecurityLoading] = useState(false);
  const directoryRequestRef = useRef(0);

  const loadDirectory = async (next: PlatformInstituteCursor | null = null) => {
    const requestId = directoryRequestRef.current + 1;
    directoryRequestRef.current = requestId;
    setDirectoryLoading(true);
    setError("");
    try {
      const page = await listPlatformInstitutes({
        limit: 50,
        cursor: next,
        search: query,
        status,
      });

      // A slower response for an older search/filter must never overwrite newer results.
      if (requestId !== directoryRequestRef.current) return;

      setInstitutes(page.items);
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
      setCursor(next);
      setLastRefreshedAt(new Date().toISOString());
    } catch (e) {
      if (requestId !== directoryRequestRef.current) return;
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load the institute directory.");
    } finally {
      if (requestId === directoryRequestRef.current) {
        setDirectoryLoading(false);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const verify = async () => {
      try {
        const session = await supabase.auth.getSession();
        if (session.error || !session.data.session) {
          setAuthenticated(false);
          setAllowed(false);
          setLoading(false);
          return;
        }

        const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal.error) throw aal.error;
        if (aal.data?.currentLevel !== "aal2") {
          setAuthenticated(false);
          setAllowed(false);
          setLoading(false);
          return;
        }

        const rolesResult = await supabase.rpc("current_platform_roles");
        if (rolesResult.error) throw rolesResult.error;
        const nextRoles = (rolesResult.data || [])
          .map((row: { role?: string }) => String(row.role || ""))
          .filter(Boolean);

        setRoles(nextRoles);
        setAuthenticated(true);
        setAllowed(nextRoles.length > 0);

        if (!nextRoles.length) setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to verify platform access.");
        setAuthenticated(false);
        setAllowed(false);
        setLoading(false);
      }
    };

    void verify();

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAuthenticated(false);
        setAllowed(false);
        setRoles([]);
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authenticated === true && activeSection === "storage") void loadStorageOverview();
  }, [authenticated, activeSection]);

  useEffect(() => {
    if (authenticated === true && activeSection === "health") void loadSystemHealth();
  }, [authenticated, activeSection]);

  useEffect(() => {
    if (authenticated === true && activeSection === "analytics") void loadAnalytics(analyticsDays);
  }, [authenticated, activeSection, analyticsDays]);

  useEffect(() => {
    if (authenticated === true && activeSection === "activity") void loadAuditActivity(false);
  }, [authenticated, activeSection, auditDays, auditCategory, auditQuery]);

  useEffect(() => {
    if (authenticated === true && activeSection === "domains") void loadDomains();
  }, [authenticated, activeSection]);

  useEffect(() => {
    if (authenticated === true && activeSection === "security") void loadSecurity();
  }, [authenticated, activeSection]);

  useEffect(() => {
    if (authenticated !== true) return;
    const timer = window.setTimeout(() => {
      setCursor(null);
      void loadDirectory(null);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, status, authenticated]);

  useEffect(() => {
    if (authenticated !== true) return;
    void getPlatformInstituteStatusCounts().then(setCounts).catch((e) => {
      setError(e instanceof Error ? e.message : "Unable to load institute status counts.");
    });
    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle();
        if (rpcError) throw rpcError;
        setPlatformSettings((data || null) as PlatformSettings | null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load platform settings.");
      }
    })();
  }, [authenticated]);

  const openOverview = async (institute: PlatformInstitute) => {
    setSelected(institute);
    setOverview(null);
    setOverviewLoading(true);
    setError("");
    try {
      setOverview(await getPlatformInstituteOverview(institute.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load institute overview.");
    } finally {
      setOverviewLoading(false);
    }
  };

  const savePlatformSettings = async () => {
    if (!platformSettings || settingsWorking) return;
    setSettingsWorking(true); setError("");
    try {
      const domain = platformSettings.default_app_domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
      const enabled = platformSettings.settings.default_subdomains_enabled === true;
      if (enabled && !domain) throw new Error("A platform default app domain is required before automatic subdomains can be enabled.");
      const result = await supabase.rpc("platform_update_settings", {
        p_product_name: platformSettings.product_name.trim(),
        p_legal_name: platformSettings.legal_name.trim(),
        p_public_website_url: platformSettings.public_website_url.trim(),
        p_default_app_domain: domain || null,
        p_support_email: platformSettings.support_email.trim().toLowerCase(),
        p_default_timezone: platformSettings.default_timezone.trim() || "Asia/Kolkata",
        p_settings: platformSettings.settings,
      });
      if (result.error) throw result.error;
      setPlatformSettings(result.data as PlatformSettings);
      setSettingsOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save platform settings."); }
    finally { setSettingsWorking(false); }
  };

  const refreshCommandCenter = async () => {
    setError("");
    await Promise.allSettled([
      loadDirectory(null),
      getPlatformInstituteStatusCounts().then(setCounts),
    ]);
    setLastRefreshedAt(new Date().toISOString());
  };

  const loadSystemHealth = async () => {
    setSystemHealthLoading(true);
    setError("");
    try {
      setSystemHealth(await getPlatformSystemHealth());
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load system health.");
    } finally {
      setSystemHealthLoading(false);
    }
  };

  const loadAnalytics = async (days = analyticsDays) => {
    setAnalyticsLoading(true);
    setError("");
    try {
      setAnalyticsOverview(await getPlatformAnalytics(days));
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load platform analytics.");
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const loadAuditActivity = async (append = false) => {
    setAuditLoading(true);
    setError("");
    try {
      const next = await getPlatformAuditActivity({
        days: auditDays,
        category: auditCategory,
        search: auditQuery,
        limit: 50,
        cursor: append ? auditOverview?.next_cursor ?? null : null,
      });
      setAuditOverview((current) => append && current ? { ...next, events: [...current.events, ...next.events] } : next);
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load platform activity and audit history.");
    } finally {
      setAuditLoading(false);
    }
  };

  const loadDomains = async () => {
    setDomainsLoading(true);
    setError("");
    try {
      setDomains(await getPlatformDomains());
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load platform domains.");
    } finally {
      setDomainsLoading(false);
    }
  };

  const registerDomain = async () => {
    if (!domainInstitute || !domainHostname.trim() || domainWorking) return;
    setDomainWorking("register");
    setError("");
    try {
      const result = await registerPlatformDomain(domainInstitute, domainHostname);
      setDomainToken(result.verification_token);
      setDomainHostname("");
      await loadDomains();
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to register domain.");
    } finally {
      setDomainWorking("");
    }
  };

  const runDomainAction = async (domain: PlatformDomain, action: "verify" | "tls" | "primary" | "disable") => {
    if (domainWorking) return;
    setDomainWorking(action + ":" + domain.id);
    setError("");
    try {
      if (action === "verify") await verifyPlatformDomain(domain.id);
      if (action === "tls") await setPlatformDomainTls(domain.id, "active");
      if (action === "primary") await setPlatformPrimaryDomain(domain.id);
      if (action === "disable") await disablePlatformDomain(domain.id);
      await loadDomains();
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to update domain.");
    } finally {
      setDomainWorking("");
    }
  };

  const loadSecurity = async () => {
    setSecurityLoading(true);
    setError("");
    try {
      const [overviewResult, aalResult, factorsResult] = await Promise.all([
        getPlatformSecurityOverview(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      setSecurityOverview(overviewResult);
      setSecurityAal({
        current: aalResult.data?.currentLevel ? String(aalResult.data.currentLevel) : null,
        next: aalResult.data?.nextLevel ? String(aalResult.data.nextLevel) : null,
      });
      if (aalResult.error) throw aalResult.error;
      if (factorsResult.error) throw factorsResult.error;
      const factors = [
        ...(factorsResult.data?.totp || []),
        ...(factorsResult.data?.phone || []),
      ].map((factor: { id?: string; factor_type?: string; status?: string; friendly_name?: string | null }) => ({
        id: String(factor.id || ""),
        factor_type: String(factor.factor_type || "unknown"),
        status: String(factor.status || "unknown"),
        friendly_name: factor.friendly_name == null ? null : String(factor.friendly_name),
      }));
      setSecurityFactors(factors);
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load platform security.");
    } finally {
      setSecurityLoading(false);
    }
  };

  const loadStorageOverview = async () => {
    setStorageLoading(true);
    setError("");
    try {
      setStorageOverview(await getPlatformStorageOverview());
    } catch (e) {
      if (errorIsUnauthorized(e)) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setAuthenticated(false);
        setAllowed(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load platform storage.");
    } finally {
      setStorageLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    setAuthenticated(false);
    setAllowed(false);
    setRoles([]);
  };

  const authed = (nextRoles: string[]) => {
    setRoles(nextRoles);
    setAuthenticated(true);
    setAllowed(nextRoles.length > 0);
    setLoading(true);
  };

  if (authenticated === false) {
    return <PlatformOwnerLogin onAuthenticated={authed} />;
  }

  if (allowed === false) {
    return (
      <main className="owner-liquid-glass owner-state-card" style={{ ...shell, display: "grid", placeItems: "center", padding: 24 }}>
        <section style={{ background: "#fff", padding: 30, borderRadius: 24, maxWidth: 560 }}>
          <b>PLATFORM CONTROL CENTER</b>
          <h1>Platform access required</h1>
          <p>Active platform membership and AAL2 verification are required for this surface.</p>
        </section>
      </main>
    );
  }

  if (loading) {
    return <main className="owner-liquid-glass owner-state-card" style={{ ...shell, display: "grid", placeItems: "center" }}>Loading tenant directory…</main>;
  }

  const selectSection = (key: string) => {
    setActiveSection(key);
    setSidebarOpen(false);
    if (key === "settings") setSettingsOpen(true);
  };

  const activeNav = OWNER_NAV.flatMap((group) => group.items).find((item) => item.key === activeSection);
  const sectionCopy: Record<string, { title: string; description: string }> = {
    dashboard: { title: "Institute Overview", description: "Monitor institute health without changing institute-managed data." },
    institutes: { title: "Institutes", description: "Read-only institute health and platform-level tenant monitoring." },
    analytics: { title: "Platform Analytics", description: "Aggregate usage, activity and adoption trends across the platform." },
    storage: { title: "Storage Overview", description: "Monitor aggregate storage consumption without exposing individual files." },
    domains: { title: "Domains", description: "Platform domain and tenant-hosting controls." },
    activity: { title: "Activity & Audit", description: "Review platform-level operational activity and audit history." },
    health: { title: "System Health", description: "Check the live health of the platform services and configuration." },
    settings: { title: "Platform Settings", description: "Configure platform-wide product and hosting settings." },
    security: { title: "Security", description: "Review platform security controls and owner protection." },
  };
  const currentSectionCopy = sectionCopy[activeSection] ?? sectionCopy.dashboard;
  const auditCategoryOptions = Array.from(new Set([
    "platform", "institute", "domain", "membership", "admin", "feature",
    ...(auditOverview?.categories ?? []).map((item) => item.category),
  ])).filter(Boolean);

  return (
    <main className="owner-liquid-glass" style={shell}>
      <button type="button" className="owner-sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "Close owner navigation" : "Open owner navigation"} aria-expanded={sidebarOpen}>{sidebarOpen ? "×" : "☰"}</button>
      <div className={`owner-sidebar-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`owner-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="owner-sidebar-brand"><div className="owner-sidebar-logo">LG</div><div><strong>Platform Owner</strong><span>Control Center</span></div></div>
        <nav className="owner-sidebar-nav" aria-label="Owner navigation">
          {OWNER_NAV.map((group) => <div className="owner-sidebar-group" key={group.group}><div className="owner-sidebar-label">{group.group}</div>{group.items.map((item) => <button type="button" key={item.key} className={`owner-sidebar-item ${activeSection === item.key ? "active" : ""}`} onClick={() => selectSection(item.key)}><span className="owner-sidebar-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>)}</div>)}
        </nav>
        <div className="owner-sidebar-footer"><div className="owner-sidebar-status"><span className="owner-online-dot" /> Platform secured</div><button type="button" className="owner-sidebar-signout" onClick={() => void signOut()}>↪ <span>Sign out</span></button></div>
      </aside>
      <div className="owner-main-shell">
      <header className="owner-header" style={{ padding: "25px clamp(16px,4vw,42px) 20px", background: "linear-gradient(135deg,#17124d,#3224a6)", color: "#fff" }}>
        <div className="owner-header-inner" style={{ maxWidth: 1280, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.6, opacity: .72 }}>PLATFORM OWNER · CONTROL PLANE</div>
            <h1 style={{ margin: "5px 0", fontSize: "clamp(28px,4vw,40px)" }}>{currentSectionCopy.title}</h1>
            <div style={{ opacity: .75 }}>{currentSectionCopy.description}</div>
          </div>
          <div className="owner-header-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setSettingsOpen(true)} style={{ ...button(false), background: "rgba(255,255,255,.14)", color: "#fff" }}>Platform settings</button>
            <button onClick={() => setCreateOpen(true)} style={{ ...button(true), background: "#fff", color: "#3224a6" }}>＋ Create institute</button>
            <span style={{ fontSize: 12, opacity: .8 }}>{roles.join(" · ")}</span>
            <button onClick={() => void signOut()} style={{ ...button(false), background: "rgba(255,255,255,.14)", color: "#fff" }}>Sign out</button>
          </div>
        </div>
      </header>

      {activeSection === "dashboard" || activeSection === "institutes" ? <div className="owner-dashboard" style={{ maxWidth: 1280, margin: "0 auto", padding: "22px clamp(16px,4vw,42px) 60px" }}>
        {error && <div role="alert" style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: "#fff1f2", color: "#b42318", border: "1px solid #fecdd3" }}>{error}</div>}

        <section className="owner-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          {[
            ["Total", counts.total],
            ["Active", counts.active],
            ["Trial", counts.trial],
            ["Suspended", counts.suspended],
            ["Archived", counts.archived],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 18, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>{label}</div>
              <div style={{ fontSize: 28, fontWeight: 900, marginTop: 5 }}>{Number(value) || 0}</div>
            </div>
          ))}
        </section>

        <section className="owner-pulse-grid" style={{ marginTop: 16, display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(280px,1fr)", gap: 12 }}>
          <div className="owner-pulse-card" style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.2 }}>PLATFORM PULSE</div>
                <h2 style={{ margin: "5px 0 2px", fontSize: 20 }}>Command center</h2>
                <div style={{ fontSize: 12, color: "#64748b" }}>A quick operational view built from platform-level aggregates.</div>
              </div>
              <button style={button(false)} onClick={() => void refreshCommandCenter()} disabled={directoryLoading}>↻ Refresh all</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 15 }}>
              <div style={{ padding: 13, borderRadius: 14, background: "#f8fafc" }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b" }}>ACTIVE SHARE</div>
                <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>{formatPercent((Number(counts.total) || 0) ? ((Number(counts.active) || 0) / (Number(counts.total) || 1)) * 100 : 0)}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>of all institutes</div>
              </div>
              <div style={{ padding: 13, borderRadius: 14, background: "#f8fafc" }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b" }}>TRIAL SHARE</div>
                <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>{formatPercent((Number(counts.total) || 0) ? ((Number(counts.trial) || 0) / (Number(counts.total) || 1)) * 100 : 0)}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>currently in trial</div>
              </div>
              <div style={{ padding: 13, borderRadius: 14, background: "#f8fafc" }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b" }}>ATTENTION QUEUE</div>
                <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>{(Number(counts.suspended) || 0) + (Number(counts.archived) || 0)}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>suspended + archived</div>
              </div>
            </div>
          </div>
          <div className="owner-filter-card" style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#64748b", letterSpacing: 1 }}>QUICK FILTERS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {(["all", "active", "trial", "suspended", "archived"] as const).map((nextStatus) => (
                <button key={nextStatus} onClick={() => { setStatus(nextStatus); setCursor(null); }} style={{ ...button(status !== nextStatus), textTransform: "capitalize", padding: "9px 12px" }}>
                  {nextStatus}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #eef1f6", fontSize: 11, color: "#64748b" }}>
              Last refreshed: <b style={{ color: "#24324a" }}>{formatDateTime(lastRefreshedAt)}</b>
            </div>
          </div>
        </section>

        <section className="owner-directory" style={{ marginTop: 16, background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, overflow: "hidden" }}>
          <div className="owner-directory-toolbar" style={{ padding: 18, borderBottom: "1px solid #eef1f6", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setQuery(search.trim()); setCursor(null); } }}
              placeholder="Search institute name or slug…"
              style={{ flex: "1 1 280px", minWidth: 220, padding: 11, borderRadius: 10, border: "1px solid #d8dee9" }}
              aria-label="Search institutes"
            />
            <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setCursor(null); }} style={{ padding: 11, borderRadius: 10, border: "1px solid #d8dee9" }}>
              <option value="all">All statuses</option>
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="archived">Archived</option>
            </select>
            <button style={button(false)} onClick={() => { setQuery(search.trim()); setCursor(null); }}>Apply</button>
            <button style={button(true)} disabled={directoryLoading} onClick={() => void loadDirectory(cursor)}>
              {directoryLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {directoryLoading && <div style={{ padding: 12, fontSize: 12, color: "#64748b" }}>Loading bounded results…</div>}

          <div className="owner-directory-table-wrap" style={{ overflowX: "auto" }}>
            <table className="owner-directory-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                  {["Institute", "Slug", "Status", "Created", "Overview"].map((heading) => <th key={heading} style={{ padding: 12, fontSize: 11, color: "#64748b" }}>{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {institutes.map((institute) => (
                  <tr key={institute.id} style={{ borderTop: "1px solid #eef1f6" }}>
                    <td style={{ padding: 13, fontWeight: 900 }}>{institute.name}</td>
                    <td style={{ padding: 13, fontSize: 12, color: "#64748b" }}>{institute.slug}</td>
                    <td style={{ padding: 13 }}><span style={{ ...statusTone(institute.status), display: "inline-flex", padding: "5px 9px", borderRadius: 999, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>{institute.status}</span></td>
                    <td style={{ padding: 13, fontSize: 12, color: "#64748b" }}>{new Date(institute.created_at).toLocaleString()}</td>
                    <td style={{ padding: 13 }}><button style={button(false)} onClick={() => void openOverview(institute)}>View health</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!institutes.length && <div style={{ padding: 28, color: "#64748b" }}>No institutes match the current search.</div>}

          <div className="owner-pagination" style={{ padding: 14, borderTop: "1px solid #eef1f6", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Showing up to 50 tenants per page · server-side search/filtering</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={button(false)} disabled={!cursor || directoryLoading} onClick={() => void loadDirectory(null)}>First page</button>
              <button style={button(true)} disabled={!hasMore || directoryLoading || !nextCursor} onClick={() => void loadDirectory(nextCursor)}>Next page</button>
            </div>
          </div>
        </section>


      </div> : null}

      <InstituteOnboardingWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          setActiveSection("institutes");
          setCursor(null);
          invalidatePlatformInstituteStatusCounts();
          void getPlatformInstituteStatusCounts().then(setCounts).catch(() => {});
          void loadDirectory(null);
        }}
      />

      {selected && (
        <div role="dialog" aria-modal="true" onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 18, zIndex: 1100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(820px,100%)", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 24, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.4 }}>READ-ONLY INSTITUTE HEALTH</div>
                <h2 style={{ margin: "5px 0 2px" }}>{selected.name}</h2>
                <div style={{ fontSize: 12, color: "#64748b" }}>{selected.slug} · {selected.status} · created {formatDateTime(selected.created_at)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={button(false)} onClick={() => void navigator.clipboard?.writeText(selected.slug)}>Copy slug</button>
                <button style={button(false)} onClick={() => setSelected(null)}>Close</button>
              </div>
            </div>
            {overviewLoading && <div style={{ padding: 28, color: "#64748b" }}>Loading institute health…</div>}
            {overview && (
              <div style={{ marginTop: 18 }}>
                <div style={{ padding: 13, borderRadius: 14, background: "#f8fafc", border: "1px solid #e7ebf2", fontSize: 12 }}>
                  <b>Monitoring only.</b> The platform owner can see institute health, but cannot edit students, teachers, admin roles, or institute-managed records here.
                </div>
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
                  {[
                    ["People", overview.people.total_active > 0 ? "Configured" : "No active members"],
                    ["Admin coverage", overview.people.admin_portals > 0 ? "Admin portal present" : "Needs admin portal"],
                    ["Storage", overview.storage.limit_bytes ? "Quota configured" : "Quota not configured"],
                    ["Content", (overview.activity.materials + overview.activity.homework + overview.activity.tests) > 0 ? "Content is present" : "No tracked content yet"],
                  ].map(([label, value]) => (
                    <div key={label} style={{ padding: 13, borderRadius: 14, border: "1px solid #e7ebf2", background: "#fff" }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b" }}>{label}</div>
                      <div style={{ marginTop: 5, fontSize: 14, fontWeight: 900 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14, padding: 16, borderRadius: 16, border: "1px solid #e7ebf2" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div><b>Content footprint</b><div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>Tracked activity records across the institute.</div></div>
                    <strong>{overview.activity.materials + overview.activity.homework + overview.activity.tests + overview.activity.announcements}</strong>
                  </div>
                  {[
                    ["Study materials", overview.activity.materials],
                    ["Homework", overview.activity.homework],
                    ["Tests", overview.activity.tests],
                    ["Announcements", overview.activity.announcements],
                  ].map(([label, value]) => {
                    const total = overview.activity.materials + overview.activity.homework + overview.activity.tests + overview.activity.announcements;
                    const width = total ? Math.max(3, (Number(value) / total) * 100) : 0;
                    return (
                      <div key={String(label)} style={{ marginTop: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" }}><span>{label}</span><b style={{ color: "#24324a" }}>{Number(value)}</b></div>
                        <div style={{ height: 7, marginTop: 5, borderRadius: 999, background: "#edf0f5", overflow: "hidden" }}><div style={{ height: "100%", width: width + "%", background: "#4f46e5", borderRadius: 999 }} /></div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10 }}>
                  {[
                    ["Students", overview.people.students],
                    ["Teachers", overview.people.teachers],
                    ["Admin portals", overview.people.admin_portals],
                    ["Active members", overview.people.total_active],
                  ].map(([label, value]) => (
                    <div key={String(label)} style={{ padding: 15, borderRadius: 16, background: "#f8fafc", border: "1px solid #e7ebf2" }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b" }}>{label}</div>
                      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 5 }}>{Number(value)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14, padding: 16, borderRadius: 16, border: "1px solid #e7ebf2" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div><b>Storage</b><div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>Tracked study-material and homework file usage.</div></div>
                    <strong>{formatBytes(overview.storage.used_bytes)} / {formatBytes(overview.storage.limit_bytes)}</strong>
                  </div>
                  <div style={{ height: 10, borderRadius: 999, background: "#e8ecf5", marginTop: 12, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: overview.storage.limit_bytes ? String(Math.min(100, overview.storage.used_bytes / overview.storage.limit_bytes * 100)) + "%" : "0%", background: "#4f46e5" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 12 }}>
                    <div><div style={{ fontSize: 10, color: "#64748b" }}>Study materials</div><b>{formatBytes(overview.storage.tracked_sources.study_materials_bytes)}</b></div>
                    <div><div style={{ fontSize: 10, color: "#64748b" }}>Homework files</div><b>{formatBytes(overview.storage.tracked_sources.homework_bytes)}</b></div>
                  </div>
                </div>
                <div style={{ marginTop: 14, padding: 16, borderRadius: 16, border: "1px solid #e7ebf2" }}>
                  <b>Institute activity</b>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10, marginTop: 12 }}>
                    {[
                      ["Study materials", overview.activity.materials],
                      ["Homework", overview.activity.homework],
                      ["Tests", overview.activity.tests],
                      ["Announcements", overview.activity.announcements],
                      ["Attendance records", overview.activity.attendance_records],
                    ].map(([label, value]) => (
                      <div key={String(label)} style={{ padding: 12, borderRadius: 12, background: "#f8fafc" }}>
                        <div style={{ fontSize: 10, color: "#64748b" }}>{label}</div>
                        <b style={{ fontSize: 20 }}>{Number(value)}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {activeSection === "analytics" && (
        <section className="owner-analytics-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px clamp(16px,4vw,42px) 60px" }}>
          <div className="owner-analytics-heading" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.2 }}>PLATFORM ANALYTICS</div>
              <h2 style={{ margin: "5px 0", fontSize: 28 }}>Usage & adoption</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>Aggregate platform activity only — no individual users, messages, or files are exposed.</p>
            </div>
            <div className="owner-analytics-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div className="owner-analytics-range" style={{ display: "flex", gap: 6 }}>
                {[7, 30, 90].map((days) => (
                  <button key={days} type="button" onClick={() => setAnalyticsDays(days)} disabled={analyticsLoading} style={{ ...button(days !== analyticsDays), minHeight: 42, padding: "9px 12px" }}>{days}d</button>
                ))}
              </div>
              <button style={button(true)} onClick={() => void loadAnalytics(analyticsDays)} disabled={analyticsLoading}>{analyticsLoading ? "Refreshing…" : "↻ Refresh analytics"}</button>
            </div>
          </div>

          {error && <div role="alert" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff1f2", color: "#b42318", border: "1px solid #fecdd3" }}>{error}</div>}

          {analyticsLoading && !analyticsOverview ? (
            <div className="owner-section-placeholder" style={{ margin: "24px 0 0" }}><div className="owner-placeholder-icon">↗</div><h2>Loading analytics…</h2><p>Preparing aggregate platform activity for the selected period.</p></div>
          ) : analyticsOverview ? (
            <>
              <div className="owner-analytics-stats" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, marginTop: 20 }}>
                {[
                  ["Institutes", analyticsOverview.summary.institutes],
                  ["Active institutes", analyticsOverview.summary.active_institutes],
                  ["New in period", analyticsOverview.summary.new_institutes],
                  ["Active members", analyticsOverview.summary.active_members],
                  ["Students", analyticsOverview.summary.students],
                  ["Teachers", analyticsOverview.summary.teachers],
                ].map(([label, value]) => (
                  <div key={String(label)} style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 18, padding: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b", letterSpacing: .6 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, marginTop: 6, color: "#172554" }}>{Number(value)}</div>
                  </div>
                ))}
              </div>

              <div className="owner-analytics-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(300px,.8fr)", gap: 14, marginTop: 14 }}>
                <section className="owner-analytics-chart" style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1 }}>ACTIVITY TREND</div>
                      <h3 style={{ margin: "5px 0 2px", fontSize: 20 }}>Last {analyticsOverview.range_days} days</h3>
                      <div style={{ fontSize: 12, color: "#64748b" }}>Content creation plus attendance records.</div>
                    </div>
                    <div className="owner-analytics-chart-total"><b>{analyticsOverview.summary.activity_events}</b><span>events in period</span></div>
                  </div>

                  {(() => {
                    const trend = analyticsOverview.trend;
                    const max = Math.max(1, ...trend.map((point) => point.total_activity));
                    const points = trend.map((point, index) => {
                      const x = trend.length === 1 ? 50 : (index / (trend.length - 1)) * 100;
                      const y = 94 - (point.total_activity / max) * 78;
                      return { point, x, y };
                    });
                    return (
                      <>
                        <div className="owner-analytics-svg-wrap">
                          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={"Platform activity over the last " + analyticsOverview.range_days + " days"}>
                            {[20, 40, 60, 80].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#edf0f5" strokeWidth=".6" />)}
                            <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke="#4f46e5" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
                            {points.map(({ point, x, y }) => (
                              <circle key={point.day} cx={x} cy={y} r="1.5" fill="#4f46e5">
                                <title>{new Date(point.day).toLocaleDateString()}: {point.total_activity} total events</title>
                              </circle>
                            ))}
                          </svg>
                        </div>
                        <div className="owner-analytics-chart-labels">
                          {[
                            analyticsOverview.trend[0],
                            analyticsOverview.trend[Math.floor(analyticsOverview.trend.length / 2)],
                            analyticsOverview.trend[analyticsOverview.trend.length - 1],
                          ].filter(Boolean).map((point, index) => (
                            <span key={index}>{new Date(point!.day).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                          ))}
                        </div>
                      </>
                    );
                  })()}

                  <div className="owner-analytics-legend">
                    {[
                      ["Content", analyticsOverview.summary.content_created],
                      ["Attendance", analyticsOverview.summary.attendance_records],
                      ["Engaged institutes", analyticsOverview.summary.engaged_institutes],
                    ].map(([label, value]) => (
                      <div key={String(label)}><span>{label}</span><b>{Number(value)}</b></div>
                    ))}
                  </div>
                </section>

                <section className="owner-analytics-breakdown" style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, padding: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#64748b", letterSpacing: 1 }}>PERIOD SUMMARY</div>
                  <div className="owner-analytics-summary-grid">
                    {[
                      ["Activity events", analyticsOverview.summary.activity_events],
                      ["Content created", analyticsOverview.summary.content_created],
                      ["Attendance records", analyticsOverview.summary.attendance_records],
                      ["Engaged institutes", analyticsOverview.summary.engaged_institutes],
                    ].map(([label, value]) => (
                      <div key={String(label)}><span>{label}</span><b>{Number(value)}</b></div>
                    ))}
                  </div>
                  <div className="owner-analytics-adoption">
                    <div><span>Active-institute engagement</span><b>{formatPercent(analyticsOverview.summary.active_institutes ? (analyticsOverview.summary.engaged_institutes / analyticsOverview.summary.active_institutes) * 100 : 0)}</b></div>
                    <div className="owner-analytics-progress"><span style={{ width: Math.min(100, analyticsOverview.summary.active_institutes ? (analyticsOverview.summary.engaged_institutes / analyticsOverview.summary.active_institutes) * 100 : 0) + "%" }} /></div>
                    <small>Institutes with at least one tracked event in the selected period.</small>
                  </div>
                </section>
              </div>

              <section className="owner-analytics-institutes" style={{ marginTop: 14, background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, overflow: "hidden" }}>
                <div className="owner-analytics-institutes-head" style={{ padding: 18, borderBottom: "1px solid #eef1f6", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div><b>Institute usage</b><div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>Aggregate activity for up to 100 institutes in the selected period.</div></div>
                  <span>{analyticsOverview.institutes.length} shown</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="owner-analytics-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead>
                      <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                        {["Institute", "Status", "Members", "Students", "Teachers", "Activity", "Content", "Last activity"].map((heading) => <th key={heading} style={{ padding: 12, fontSize: 10, color: "#64748b" }}>{heading}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsOverview.institutes.map((item) => (
                        <tr key={item.id} style={{ borderTop: "1px solid #eef1f6" }}>
                          <td style={{ padding: 13 }}><b>{item.name}</b><div style={{ fontSize: 10, color: "#94a3b8" }}>{item.slug}</div></td>
                          <td style={{ padding: 13 }}><span style={{ ...statusTone(item.status), padding: "5px 8px", borderRadius: 999, fontSize: 9, fontWeight: 900, textTransform: "uppercase" }}>{item.status}</span></td>
                          <td style={{ padding: 13, fontWeight: 800 }}>{item.active_members}</td>
                          <td style={{ padding: 13 }}>{item.students}</td>
                          <td style={{ padding: 13 }}>{item.teachers}</td>
                          <td style={{ padding: 13, fontWeight: 900 }}>{item.activity_events}</td>
                          <td style={{ padding: 13 }}>{item.content_created}</td>
                          <td style={{ padding: 13, fontSize: 11, color: "#64748b" }}>{item.last_activity_at ? formatDateTime(item.last_activity_at) : "No activity"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!analyticsOverview.institutes.length && <div style={{ padding: 28, color: "#64748b" }}>No institute activity was recorded for the selected period.</div>}
              </section>
            </>
          ) : null}
        </section>
      )}

      {activeSection === "storage" && (
        <section className="owner-storage-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px clamp(16px,4vw,42px) 60px" }}>
          <div className="owner-storage-heading" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.2 }}>PLATFORM STORAGE</div>
              <h2 style={{ margin: "5px 0", fontSize: 28 }}>Storage overview</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>Read-only storage usage across all institutes. Individual files and users are never exposed.</p>
            </div>
            <button style={button(true)} onClick={() => void loadStorageOverview()} disabled={storageLoading}>{storageLoading ? "Refreshing…" : "↻ Refresh storage"}</button>
          </div>

          {error && <div role="alert" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff1f2", color: "#b42318", border: "1px solid #fecdd3" }}>{error}</div>}

          {storageLoading && !storageOverview ? (
            <div className="owner-section-placeholder" style={{ margin: "24px 0 0" }}><div className="owner-placeholder-icon">▣</div><h2>Loading storage…</h2><p>Calculating aggregate storage usage from study materials and homework.</p></div>
          ) : storageOverview ? (
            <>
              <div className="owner-storage-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginTop: 20 }}>
                {[
                  ["Used storage", formatBytes(storageOverview.totals.used_bytes)],
                  ["Study materials", formatBytes(storageOverview.totals.study_materials_bytes)],
                  ["Homework files", formatBytes(storageOverview.totals.homework_bytes)],
                  ["Institutes using storage", String(storageOverview.totals.institutes_with_storage)],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 18, padding: 17, boxShadow: "0 12px 30px rgba(50,58,100,.06)" }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b", letterSpacing: .7 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, marginTop: 7, color: "#172554" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="owner-storage-summary" style={{ marginTop: 14, background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div><b>Platform quota</b><div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>Sum of institute quotas that are configured.</div></div>
                  <strong>{storageOverview.totals.configured_quota_bytes > 0 ? formatBytes(storageOverview.totals.configured_quota_bytes) : "Not configured"}</strong>
                </div>
                {storageOverview.totals.configured_quota_bytes > 0 && (
                  <div style={{ marginTop: 12, height: 10, borderRadius: 999, background: "#eef2ff", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: Math.min(100, (storageOverview.totals.used_bytes / storageOverview.totals.configured_quota_bytes) * 100) + "%", background: "#4f46e5", borderRadius: 999 }} />
                  </div>
                )}
              </div>

              <div className="owner-storage-table" style={{ marginTop: 14, background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, overflow: "hidden" }}>
                <div style={{ padding: 18, borderBottom: "1px solid #eef1f6" }}>
                  <b>Institute storage usage</b><div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>Up to 100 institutes, ordered by storage used.</div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                    <thead><tr style={{ textAlign: "left", background: "#f8fafc" }}>
                      {["Institute", "Status", "Used", "Study materials", "Homework", "Quota"].map((heading) => <th key={heading} style={{ padding: 12, fontSize: 10, color: "#64748b" }}>{heading}</th>)}
                    </tr></thead>
                    <tbody>
                      {storageOverview.institutes.map((item) => (
                        <tr key={item.id} style={{ borderTop: "1px solid #eef1f6" }}>
                          <td style={{ padding: 13 }}><b>{item.name}</b><div style={{ fontSize: 10, color: "#94a3b8" }}>{item.slug}</div></td>
                          <td style={{ padding: 13 }}><span style={{ ...statusTone(item.status), padding: "5px 8px", borderRadius: 999, fontSize: 9, fontWeight: 900, textTransform: "uppercase" }}>{item.status}</span></td>
                          <td style={{ padding: 13, fontWeight: 900 }}>{formatBytes(item.used_bytes)}</td>
                          <td style={{ padding: 13, color: "#475569" }}>{formatBytes(item.study_materials_bytes)}</td>
                          <td style={{ padding: 13, color: "#475569" }}>{formatBytes(item.homework_bytes)}</td>
                          <td style={{ padding: 13, color: "#475569" }}>{formatBytes(item.quota_bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!storageOverview.institutes.length && <div style={{ padding: 28, color: "#64748b" }}>No institute storage data is available yet.</div>}
              </div>
            </>
          ) : null}
        </section>
      )}

      {activeSection === "health" && (
        <section className="owner-health-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px clamp(16px,4vw,42px) 60px" }}>
          <div className="owner-health-heading" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.2 }}>PLATFORM OPERATIONS</div>
              <h2 style={{ margin: "5px 0", fontSize: 28 }}>System health</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>Read-only checks for the platform database, tenant registry, domains, storage, configuration, and audit trail.</p>
            </div>
            <button style={button(true)} onClick={() => void loadSystemHealth()} disabled={systemHealthLoading}>{systemHealthLoading ? "Checking…" : "↻ Run health check"}</button>
          </div>

          {error && <div role="alert" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff1f2", color: "#b42318", border: "1px solid #fecdd3" }}>{error}</div>}

          {systemHealthLoading && !systemHealth ? (
            <div className="owner-section-placeholder" style={{ marginTop: 24 }}><div className="owner-placeholder-icon">♥</div><h2>Checking platform health…</h2><p>Running secure aggregate checks now.</p></div>
          ) : systemHealth ? (
            <>
              <div className="owner-health-hero" style={{ marginTop: 20, padding: 20, borderRadius: 22, background: "#fff", border: "1px solid #e7ebf2", boxShadow: "0 12px 34px rgba(50,58,100,.07)" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.2, color: "#64748b" }}>OVERALL STATUS</div>
                  <div className="owner-health-status" data-status={systemHealth.overall}>
                    <span className="owner-health-dot" /> {systemHealth.overall === "healthy" ? "All monitored systems healthy" : systemHealth.overall === "degraded" ? "Some systems need attention" : "Attention required"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Last checked {formatDateTime(systemHealth.checked_at)}</div>
                </div>
              </div>

              <div className="owner-health-summary" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 10, marginTop: 14 }}>
                {[
                  ["Institutes", systemHealth.summary.institutes],
                  ["Active", systemHealth.summary.active_institutes],
                  ["Domains", systemHealth.summary.registered_domains],
                  ["Primary domains", systemHealth.summary.primary_domains],
                  ["Storage buckets", systemHealth.summary.storage_buckets],
                  ["Audit events", systemHealth.summary.audit_events],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 16, padding: 14 }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: "#64748b", textTransform: "uppercase" }}>{label}</div>
                    <div style={{ marginTop: 5, fontSize: 21, fontWeight: 900 }}>{Number(value)}</div>
                  </div>
                ))}
              </div>

              <div className="owner-health-checks" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
                {systemHealth.checks.map((check) => (
                  <article key={check.key} className="owner-health-check-card">
                    <div className="owner-health-check-top">
                      <div><b>{check.label}</b><div className="owner-health-check-message">{check.message}</div></div>
                      <span className="owner-health-badge" data-status={check.status}>{check.status}</span>
                    </div>
                    <div className="owner-health-check-detail">{check.detail}</div>
                  </article>
                ))}
              </div>

              <div className="owner-health-config" style={{ marginTop: 14, padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e7ebf2" }}>
                <b>Platform configuration snapshot</b>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 10 }}>
                  <div><div style={{ fontSize: 10, color: "#64748b" }}>Default app domain</div><strong>{systemHealth.configuration.default_app_domain || "Not configured"}</strong></div>
                  <div><div style={{ fontSize: 10, color: "#64748b" }}>Automatic subdomains</div><strong>{systemHealth.configuration.automatic_subdomains_enabled ? "Enabled" : "Disabled"}</strong></div>
                </div>
              </div>
            </>
          ) : null}
        </section>
      )}

      {activeSection === "activity" && (
        <section className="owner-audit-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px clamp(16px,4vw,42px) 60px" }}>
          <div className="owner-audit-heading" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.2 }}>PLATFORM OPERATIONS</div>
              <h2 style={{ margin: "5px 0", fontSize: 28 }}>Activity & audit</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>Platform-scoped audit history with institute context. Individual users, metadata and file contents are intentionally not exposed.</p>
            </div>
            <div className="owner-audit-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {[7, 30, 90].map((days) => (
                <button key={days} type="button" onClick={() => setAuditDays(days)} disabled={auditLoading} style={{ ...button(days !== auditDays), minHeight: 42, padding: "9px 12px" }}>{days}d</button>
              ))}
              <button style={button(true)} onClick={() => void loadAuditActivity(false)} disabled={auditLoading}>{auditLoading ? "Refreshing…" : "↻ Refresh activity"}</button>
            </div>
          </div>

          {error && <div role="alert" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff1f2", color: "#b42318", border: "1px solid #fecdd3" }}>{error}</div>}

          {auditLoading && !auditOverview ? (
            <div className="owner-section-placeholder" style={{ marginTop: 24 }}><div className="owner-placeholder-icon">☷</div><h2>Loading audit history…</h2><p>Preparing secure platform events for the selected period.</p></div>
          ) : auditOverview ? (
            <>
              <div className="owner-audit-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 20 }}>
                {[
                  ["Events", auditOverview.total_events],
                  ["Last 24 hours", auditOverview.last_24h_events],
                  ["Institutes touched", auditOverview.institutes_with_activity],
                  ["Action categories", auditOverview.categories.length],
                ].map(([label, value]) => (
                  <div key={String(label)} style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 18, padding: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b", letterSpacing: .6 }}>{label}</div>
                    <div style={{ fontSize: 25, fontWeight: 900, marginTop: 6, color: "#172554" }}>{Number(value)}</div>
                  </div>
                ))}
              </div>

              <section className="owner-audit-filter-card" style={{ marginTop: 14, padding: 16, borderRadius: 20, background: "#fff", border: "1px solid #e7ebf2" }}>
                <div className="owner-audit-filter-grid">
                  <label>
                    <span>Search events</span>
                    <input
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") setAuditQuery(auditSearch.trim()); }}
                      placeholder="Action, institute, entity or summary…"
                      aria-label="Search platform audit events"
                    />
                  </label>
                  <label>
                    <span>Action category</span>
                    <select value={auditCategory} onChange={(e) => setAuditCategory(e.target.value)}>
                      <option value="all">All categories</option>
                      {auditCategoryOptions.map((category) => <option key={category} value={category}>{category.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <button type="button" style={{ ...button(false), alignSelf: "end", minHeight: 44 }} onClick={() => setAuditQuery(auditSearch.trim())}>Apply filters</button>
                </div>
                <div className="owner-audit-scope-note">Scope: <b>platform</b> · Window: <b>last {auditOverview.range_days} days</b> · Raw metadata and actor identities are not returned to this interface.</div>
              </section>

              <div className="owner-audit-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(260px,.35fr)", gap: 14, marginTop: 14 }}>
                <section className="owner-audit-events" style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, overflow: "hidden" }}>
                  <div className="owner-audit-events-head" style={{ padding: 18, borderBottom: "1px solid #eef1f6" }}>
                    <div><b>Event stream</b><div style={{ marginTop: 3, color: "#64748b", fontSize: 12 }}>Newest platform events first. Audit records are read-only here.</div></div>
                  </div>

                  {auditOverview.events.length ? (
                    <div className="owner-audit-event-list">
                      {auditOverview.events.map((event) => (
                        <article className="owner-audit-event" key={event.id}>
                          <div className="owner-audit-event-time">{formatDateTime(event.created_at)}</div>
                          <div className="owner-audit-event-main">
                            <div className="owner-audit-event-top">
                              <span className="owner-audit-badge">{event.category}</span>
                              <strong>{event.action.replaceAll(".", " · ")}</strong>
                            </div>
                            <div className="owner-audit-event-summary">{event.summary || "No summary recorded."}</div>
                            <div className="owner-audit-event-meta">
                              <span>{event.institute_name}</span>
                              <span>{event.entity_type || "platform event"}</span>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="owner-audit-empty">
                      <div className="owner-placeholder-icon">☷</div>
                      <h3>No platform events found</h3>
                      <p>No audit records match the selected window and filters. New platform operations that write to the audit log will appear here automatically.</p>
                    </div>
                  )}

                  {auditOverview.has_more && (
                    <div className="owner-audit-load-more">
                      <button type="button" style={button(false)} onClick={() => void loadAuditActivity(true)} disabled={auditLoading}>{auditLoading ? "Loading more…" : "Load more events"}</button>
                    </div>
                  )}
                </section>

                <aside className="owner-audit-category-card" style={{ background: "#fff", border: "1px solid #e7ebf2", borderRadius: 20, padding: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#64748b", letterSpacing: 1 }}>ACTIVITY MIX</div>
                  <h3 style={{ margin: "5px 0 2px", fontSize: 19 }}>Event categories</h3>
                  <div style={{ marginTop: 12 }}>
                    {auditOverview.categories.length ? auditOverview.categories.map((item) => {
                      const share = auditOverview.total_events ? Math.round((item.count / auditOverview.total_events) * 100) : 0;
                      return (
                        <div className="owner-audit-category-row" key={item.category}>
                          <div><span>{item.category}</span><b>{item.count}</b></div>
                          <div className="owner-audit-progress"><span style={{ width: Math.min(100, share) + "%" }} /></div>
                        </div>
                      );
                    }) : <div className="owner-audit-no-categories">No categories in this period.</div>}
                  </div>
                </aside>
              </div>
            </>
          ) : null}
        </section>
      )}

      {activeSection === "domains" && (
        <section className="owner-domains-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px clamp(16px,4vw,42px) 60px" }}>
          <div className="owner-domains-heading" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.2 }}>PLATFORM HOSTING</div>
              <h2 style={{ margin: "5px 0", fontSize: 28 }}>Domains</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>Manage tenant portal hostnames, DNS verification, TLS state and primary routing. Domain actions are protected by Owner MFA.</p>
            </div>
            <button type="button" style={button(true)} onClick={() => { setDomainOpen(true); setDomainToken(null); }}>＋ Add custom domain</button>
          </div>

          {error && <div role="alert" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff1f2", color: "#b42318", border: "1px solid #fecdd3" }}>{error}</div>}

          {domainsLoading ? (
            <div className="owner-section-placeholder" style={{ marginTop: 24 }}><div className="owner-placeholder-icon">◎</div><h2>Loading domains…</h2><p>Checking tenant hostname and TLS state.</p></div>
          ) : (
            <>
              <div className="owner-domain-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 20 }}>
                {[
                  ["Total domains", domains.length],
                  ["Verified", domains.filter(d => d.status === "verified").length],
                  ["TLS active", domains.filter(d => d.tls_status === "active").length],
                  ["Primary", domains.filter(d => d.is_primary).length],
                ].map(([label,value]) => <div key={String(label)} style={{ background:"#fff", border:"1px solid #e7ebf2", borderRadius:18, padding:16 }}><div style={{fontSize:10,fontWeight:900,color:"#64748b",letterSpacing:.6}}>{label}</div><div style={{fontSize:25,fontWeight:900,marginTop:6,color:"#172554"}}>{Number(value)}</div></div>)}
              </div>

              <section className="owner-domain-table" style={{ marginTop:14, background:"#fff", border:"1px solid #e7ebf2", borderRadius:20, overflow:"hidden" }}>
                <div style={{padding:18,borderBottom:"1px solid #eef1f6"}}><b>Tenant domains</b><div style={{marginTop:3,color:"#64748b",fontSize:12}}>Default subdomains and custom domains are shown together. Verification tokens are only shown immediately after registration.</div></div>
                {domains.length ? <div className="owner-domain-table-wrap"><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["Institute","Hostname","Type","Status","TLS","Primary","Actions"].map(h=><th key={h} style={{textAlign:"left",padding:"11px 14px",fontSize:9,color:"#64748b",letterSpacing:.06,textTransform:"uppercase",borderBottom:"1px solid #eef1f6"}}>{h}</th>)}</tr></thead><tbody>{domains.map(d=>{
                  const busy=domainWorking.includes(d.id);
                  return <tr key={d.id}>
                    <td><strong>{d.institute_name}</strong><div style={{fontSize:10,color:"#8a94a8"}}>{d.institute_slug || "—"}</div></td>
                    <td><code>{d.hostname}</code></td>
                    <td>{d.domain_type.replaceAll("_"," ")}</td>
                    <td><span className="owner-domain-badge" data-tone={d.status}>{d.status}</span></td>
                    <td><span className="owner-domain-badge" data-tone={d.tls_status}>{d.tls_status}</span></td>
                    <td>{d.is_primary ? "✓ Primary" : "—"}</td>
                    <td><div className="owner-domain-actions">
                      {d.status === "pending" && <button style={button(false)} disabled={busy} onClick={() => void runDomainAction(d,"verify")}>{busy ? "Working…" : "Record DNS verified"}</button>}
                      {d.status === "verified" && d.tls_status !== "active" && <button style={button(false)} disabled={busy} onClick={() => void runDomainAction(d,"tls")}>{busy ? "Working…" : "Set TLS active"}</button>}
                      {d.status === "verified" && d.tls_status === "active" && !d.is_primary && <button style={button(false)} disabled={busy} onClick={() => void runDomainAction(d,"primary")}>{busy ? "Working…" : "Set primary"}</button>}
                      {!d.is_primary && d.status !== "disabled" && <button style={{...button(false),color:"#b42318"}} disabled={busy} onClick={() => void runDomainAction(d,"disable")}>{busy ? "Working…" : "Disable"}</button>}
                    </div></td>
                  </tr>;
                })}</tbody></table></div> : <div className="owner-domain-empty"><div className="owner-placeholder-icon">◎</div><h3>No domains registered</h3><p>Register a custom hostname for an institute, or enable automatic subdomains in Platform Settings for future tenant provisioning.</p></div>}
              </section>
            </>
          )}
        </section>
      )}

      {activeSection === "security" && (
        <section className="owner-security-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px clamp(16px,4vw,42px) 60px" }}>
          <div className="owner-security-heading" style={{ display:"flex", justifyContent:"space-between", gap:16, alignItems:"start", flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:11, fontWeight:900, color:"#4f46e5", letterSpacing:1.2 }}>PLATFORM PROTECTION</div>
              <h2 style={{ margin:"5px 0", fontSize:28 }}>Security</h2>
              <p style={{ margin:0, color:"#64748b", fontSize:13 }}>Monitor Owner access, MFA assurance, backend authorization and platform security signals. This page does not expose secrets or individual account data.</p>
            </div>
            <button type="button" style={button(true)} onClick={() => void loadSecurity()} disabled={securityLoading}>{securityLoading ? "Checking…" : "Refresh security"}</button>
          </div>

          {error && <div role="alert" style={{ marginTop:14, padding:12, borderRadius:12, background:"#fff1f2", color:"#b42318", border:"1px solid #fecdd3" }}>{error}</div>}

          {securityLoading && !securityOverview ? (
            <div className="owner-section-placeholder" style={{ marginTop:24 }}><div className="owner-placeholder-icon">🔐</div><h2>Checking security…</h2><p>Verifying the current Owner session and platform protection controls.</p></div>
          ) : securityOverview && (
            <>
              <div className="owner-security-banner" style={{ marginTop:20, display:"flex", alignItems:"center", justifyContent:"space-between", gap:14, flexWrap:"wrap", background:"#fff", border:"1px solid #e7ebf2", borderRadius:20, padding:18 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:900, color:"#64748b", letterSpacing:.8 }}>OWNER ACCESS STATE</div>
                  <div style={{ marginTop:5, fontSize:22, fontWeight:900 }}>{securityOverview.owner_access_granted ? "Protected & authorized" : "Verification required"}</div>
                  <div style={{ marginTop:4, fontSize:11, color:"#64748b" }}>Backend owner gate: {securityOverview.backend_owner_gate ? "Active" : "Not active"}</div>
                </div>
                <div className="owner-security-status" data-tone={securityOverview.owner_access_granted && securityAal.current === "aal2" ? "healthy" : "attention"}>{securityOverview.owner_access_granted && securityAal.current === "aal2" ? "SECURE SESSION" : "ACTION REQUIRED"}</div>
              </div>

              <div className="owner-security-grid">
                {[
                  ["MFA policy", securityOverview.mfa_required ? "Required" : "Optional", securityOverview.mfa_required],
                  ["Current assurance", securityAal.current?.toUpperCase() || "—", securityAal.current === "aal2"],
                  ["Owner membership", securityOverview.owner_membership_present ? "Present" : "Missing", securityOverview.owner_membership_present],
                  ["Audit logging", securityOverview.audit_logging_enabled ? "Available" : "Unavailable", securityOverview.audit_logging_enabled],
                  ["TLS-active domains", securityOverview.domain_tls_active, securityOverview.domain_tls_failed === 0],
                  ["TLS failures", securityOverview.domain_tls_failed, securityOverview.domain_tls_failed === 0],
                ].map(([label,value,ok]) => <div key={String(label)} className="owner-security-card"><div style={{fontSize:10,fontWeight:900,color:"#64748b",letterSpacing:.5}}>{label}</div><div style={{fontSize:21,fontWeight:900,marginTop:7}}>{String(value)}</div><span className="owner-security-chip" data-tone={ok ? "healthy" : "attention"}>{ok ? "OK" : "Attention"}</span></div>)}
              </div>

              <section className="owner-security-detail" style={{ marginTop:14, background:"#fff", border:"1px solid #e7ebf2", borderRadius:20, padding:18 }}>
                <div style={{fontWeight:900}}>MFA factors</div>
                <div style={{fontSize:11,color:"#64748b",marginTop:4}}>Only factor type, verification state and friendly name are shown. Secrets and recovery codes are never returned.</div>
                <div className="owner-security-factor-list">
                  {securityFactors.length ? securityFactors.map((factor) => <div key={factor.id} className="owner-security-factor">
                    <div><strong>{factor.friendly_name || (factor.factor_type === "totp" ? "Authenticator app" : factor.factor_type)}</strong><span>{factor.factor_type.toUpperCase()}</span></div>
                    <span className="owner-security-chip" data-tone={factor.status === "verified" ? "healthy" : "attention"}>{factor.status}</span>
                  </div>) : <div className="owner-security-empty">No MFA factor is currently registered for this session.</div>}
                </div>
                <div style={{ marginTop:14, padding:12, borderRadius:12, background:"#f8fafc", color:"#64748b", fontSize:11, lineHeight:1.5 }}>
                  The Owner login flow requires AAL2 before the control plane is unlocked. MFA enrollment and verification are handled through the dedicated Owner sign-in flow.
                </div>
              </section>

              <section className="owner-security-detail" style={{ marginTop:14, background:"#fff", border:"1px solid #e7ebf2", borderRadius:20, padding:18 }}>
                <div style={{fontWeight:900}}>Security architecture</div>
                <div className="owner-security-architecture">
                  <div><b>Google OAuth</b><span>Password login is not exposed on the Owner panel.</span></div>
                  <div><b>Backend authorization</b><span>Owner RPCs check the platform-owner access gate server-side.</span></div>
                  <div><b>Audit trail</b><span>Platform operations are recorded for operational review.</span></div>
                  <div><b>Domain protection</b><span>{securityOverview.registered_domains} registered domain{securityOverview.registered_domains === 1 ? "" : "s"} · {securityOverview.domain_tls_active} TLS-active.</span></div>
                </div>
              </section>
            </>
          )}
        </section>
      )}

            {activeSection !== "dashboard" && activeSection !== "institutes" && activeSection !== "storage" && activeSection !== "health" && activeSection !== "settings" && activeSection !== "activity" && activeSection !== "domains" && <section className="owner-section-placeholder"><div className="owner-placeholder-icon">{activeNav?.icon}</div><h2>{activeNav?.label}</h2><p>This platform section is now part of the Owner navigation. Platform-level controls can be added here without exposing institute-managed users or roles.</p></section>}

      {domainOpen && (
        <div role="dialog" aria-modal="true" onClick={() => { if (!domainWorking) setDomainOpen(false); }} style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)", display:"grid", placeItems:"center", padding:18, zIndex:1300 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width:"min(560px,100%)", background:"#fff", borderRadius:24, padding:24 }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:14, alignItems:"start" }}>
              <div><b>DOMAIN REGISTRATION</b><h2 style={{ margin:"5px 0" }}>Add custom domain</h2><div style={{ fontSize:12, color:"#64748b" }}>Register the hostname first, then add the DNS TXT record before recording verification.</div></div>
              <button type="button" style={button(false)} onClick={() => setDomainOpen(false)}>Close</button>
            </div>
            <label style={{ display:"block", fontSize:12, fontWeight:800, marginTop:16 }}>Institute
              <select value={domainInstitute} onChange={(e) => setDomainInstitute(e.target.value)} style={{ width:"100%", boxSizing:"border-box", marginTop:5, padding:11, borderRadius:11, border:"1px solid #d8dee9" }}>
                <option value="">Choose institute</option>
                {institutes.map((institute) => <option key={institute.id} value={institute.id}>{institute.name}</option>)}
              </select>
            </label>
            <label style={{ display:"block", fontSize:12, fontWeight:800, marginTop:12 }}>Hostname
              <input value={domainHostname} onChange={(e) => setDomainHostname(e.target.value)} placeholder="portal.example.org" style={{ width:"100%", boxSizing:"border-box", marginTop:5, padding:11, borderRadius:11, border:"1px solid #d8dee9" }} />
            </label>
            {domainToken && <div style={{ marginTop:14, padding:14, borderRadius:14, background:"#f8fafc", border:"1px solid #e7ebf2" }}>
              <b style={{ fontSize:12 }}>DNS TXT verification</b>
              <div style={{ marginTop:5, fontSize:11, color:"#64748b", lineHeight:1.5 }}>Create a TXT record for <code>_mahin-verification</code> on the registered hostname with this value:</div>
              <code style={{ display:"block", marginTop:9, padding:10, borderRadius:10, background:"#fff", border:"1px solid #e7ebf2", wordBreak:"break-all" }}>{domainToken}</code>
              <div style={{ marginTop:8, fontSize:10, color:"#8a94a8" }}>Keep this token private. After DNS propagation, close this dialog and use “Record DNS verified” from the domain list.</div>
            </div>}
            <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:18 }}>
              <button type="button" style={button(false)} onClick={() => setDomainOpen(false)}>Done</button>
              <button type="button" style={button(true)} disabled={!domainInstitute || !domainHostname.trim() || !!domainWorking} onClick={() => void registerDomain()}>{domainWorking === "register" ? "Registering…" : "Register domain"}</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && platformSettings && (
        <div role="dialog" aria-modal="true" onClick={() => { if (!settingsWorking) setSettingsOpen(false); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 18, zIndex: 1300 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(680px,100%)", background: "#fff", borderRadius: 24, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}><div><b>PLATFORM CONFIGURATION</b><h2 style={{ margin: "5px 0" }}>Platform settings</h2><div style={{ fontSize: 12, color: "#64748b" }}>Configure the platform namespace used for automatic tenant subdomains.</div></div><button disabled={settingsWorking} style={button(false)} onClick={() => setSettingsOpen(false)}>Close</button></div>
            {(["product_name","legal_name","public_website_url","default_app_domain","support_email","default_timezone"] as const).map((key) => (
              <label key={key} style={{ display: "block", fontSize: 12, fontWeight: 800, marginTop: 12 }}>{key.replaceAll("_"," ")}
                <input value={platformSettings[key] || ""} onChange={(e) => setPlatformSettings({...platformSettings,[key]:e.target.value})} style={{ width: "100%", boxSizing: "border-box", padding: 11, borderRadius: 10, border: "1px solid #d8dee9", marginTop: 5 }} />
              </label>
            ))}
            <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 15, padding: 12, borderRadius: 12, background: "#f8fafc", fontSize: 12 }}><input type="checkbox" checked={platformSettings.settings.default_subdomains_enabled === true} onChange={(e) => setPlatformSettings({...platformSettings,settings:{...platformSettings.settings,default_subdomains_enabled:e.target.checked}})} /><span><b>Enable automatic institute subdomains</b><br/><span style={{ color: "#64748b" }}>New institutes get slug + default app domain automatically.</span></span></label>
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#fffbeb", color: "#92400e", fontSize: 11 }}>Enable this only after wildcard DNS and TLS are configured for the platform domain.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}><button disabled={settingsWorking} style={button(false)} onClick={() => setSettingsOpen(false)}>Cancel</button><button disabled={settingsWorking} style={button(true)} onClick={() => void savePlatformSettings()}>{settingsWorking ? "Saving…" : "Save settings"}</button></div>
          </div>
        </div>
      )}

      </div>
    </main>
  );
}
