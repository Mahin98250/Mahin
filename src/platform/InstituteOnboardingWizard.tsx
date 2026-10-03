import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lg/supabase";

type PlatformFeature = {
  code: string;
  name: string;
  description: string;
  category: string;
  sort_order: number;
  depends_on: string[];
};

type WizardProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

const PANELS = [
  ["identity", "Institute identity", "Name, type and description"],
  ["contact", "Contact & location", "Phone, email and address"],
  ["branding", "Branding", "Logo, colors and login"],
  ["academic", "Academic setup", "Initial academic year"],
  ["features", "Features", "Enable the modules you need"],
  ["domain", "Portal access", "Custom or platform domain"],
  ["custom", "Custom feature", "Request something special"],
  ["review", "Review & create", "Check everything before launch"],
] as const;

type PanelKey = typeof PANELS[number][0];

const categoryLabels: Record<string, string> = {
  core: "Core",
  operations: "Operations",
  learning: "Learning",
  finance: "Finance",
  communication: "Communication",
  analytics: "Analytics",
  portals: "Portals",
};

const blankForm = {
  name: "",
  slug: "",
  description: "",
  instituteType: "Coaching Institute",
  phone: "",
  email: "",
  websiteUrl: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "India",
  timezone: "Asia/Kolkata",
  locale: "en-IN",
  logoUrl: "",
  coverImageUrl: "",
  faviconUrl: "",
  logoAltText: "",
  primaryColor: "",
  secondaryColor: "",
  loginTitle: "",
  poweredByEnabled: true,
  academicYearName: "",
  academicYearStartDate: "",
  academicYearEndDate: "",
  hostname: "",
  customRequestTitle: "",
  customRequestDescription: "",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "11px 12px",
  borderRadius: 11,
  border: "1px solid #d7ddea",
  background: "#fff",
  color: "#17213a",
  font: "inherit",
};

const button = (primary = false) => ({
  border: "1px solid " + (primary ? "#4f46e5" : "#d7ddea"),
  borderRadius: 11,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
  background: primary ? "#4f46e5" : "#fff",
  color: primary ? "#fff" : "#24324a",
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function labelForCategory(category: string) {
  return categoryLabels[category] || category.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function InstituteOnboardingWizard({ open, onClose, onCreated }: WizardProps) {
  const [panel, setPanel] = useState<PanelKey>("identity");
  const [form, setForm] = useState(blankForm);
  const [features, setFeatures] = useState<PlatformFeature[]>([]);
  const [enabledFeatures, setEnabledFeatures] = useState<Set<string>>(new Set());
  const [platformDomain, setPlatformDomain] = useState("");
  const [defaultSubdomainsEnabled, setDefaultSubdomainsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "cover" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [created, setCreated] = useState<{
    name: string;
    slug: string;
    status: string;
    enabled: number;
    domain: string | null;
    token: string | null;
  } | null>(null);
  const [draftId, setDraftId] = useState("");

  const featureByCode = useMemo(() => new Map(features.map((feature) => [feature.code, feature])), [features]);

  const groupedFeatures = useMemo(() => {
    const groups = new Map<string, PlatformFeature[]>();
    features.forEach((feature) => {
      const existing = groups.get(feature.category) || [];
      existing.push(feature);
      groups.set(feature.category, existing);
    });
    return Array.from(groups.entries()).sort((a, b) => {
      const aMin = Math.min(...a[1].map((x) => x.sort_order));
      const bMin = Math.min(...b[1].map((x) => x.sort_order));
      return aMin - bMin;
    });
  }, [features]);

  const setField = <K extends keyof typeof blankForm>(key: K, value: (typeof blankForm)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const reset = () => {
    setPanel("identity");
    setForm(blankForm);
    setFeatures([]);
    setEnabledFeatures(new Set());
    setPlatformDomain("");
    setDefaultSubdomainsEnabled(false);
    setLoading(false);
    setFeatureLoading(false);
    setUploading(null);
    setError("");
    setNotice("");
    setCreated(null);
    setDraftId("");
  };

  useEffect(() => {
    if (!open) return;
    setDraftId((current) => current || (crypto.randomUUID?.() || Math.random().toString(36).slice(2)));
    setError("");
    setNotice("");
    setCreated(null);
    void (async () => {
      setFeatureLoading(true);
      try {
        const [{ data: featureData, error: featureError }, { data: settingsData, error: settingsError }] = await Promise.all([
          supabase
            .from("platform_features")
            .select("code,name,description,category,sort_order,depends_on")
            .eq("status", "active")
            .order("sort_order"),
          supabase
            .from("platform_settings")
            .select("default_app_domain,settings")
            .eq("id", 1)
            .maybeSingle(),
        ]);
        if (featureError) throw featureError;
        if (settingsError) throw settingsError;
        const nextFeatures = (featureData || []) as PlatformFeature[];
        setFeatures(nextFeatures);
        setEnabledFeatures(new Set(nextFeatures.map((feature) => feature.code)));
        setPlatformDomain(String(settingsData?.default_app_domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""));
        setDefaultSubdomainsEnabled(settingsData?.settings?.default_subdomains_enabled === true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load onboarding options.");
      } finally {
        setFeatureLoading(false);
      }
    })();
  }, [open]);

  if (!open) return null;

  const uploadAsset = async (kind: "logo" | "cover", file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Images must be 5 MB or smaller.");
      return;
    }
    setError("");
    setNotice("");
    setUploading(kind);
    try {
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-120);
      const path = "onboarding/" + draftId + "/" + kind + "-" + Date.now() + "-" + safeName;
      const upload = await supabase.storage.from("institute-assets").upload(path, file, {
        upsert: false,
        cacheControl: "31536000",
        contentType: file.type,
      });
      if (upload.error) throw upload.error;
      const { data } = supabase.storage.from("institute-assets").getPublicUrl(path);
      if (!data?.publicUrl) throw new Error("Unable to create the public image URL.");
      if (kind === "logo") setField("logoUrl", data.publicUrl);
      else setField("coverImageUrl", data.publicUrl);
      setNotice((kind === "logo" ? "Logo" : "Cover image") + " uploaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to upload image.");
    } finally {
      setUploading(null);
    }
  };

  const toggleFeature = (code: string, value: boolean) => {
    setError("");
    setNotice("");
    const feature = featureByCode.get(code);
    if (!feature) return;

    setEnabledFeatures((current) => {
      const next = new Set(current);
      if (value) {
        next.add(code);
        for (const dependency of feature.depends_on) next.add(dependency);
      } else {
        const queue = [code];
        while (queue.length) {
          const currentCode = queue.shift()!;
          next.delete(currentCode);
          features.forEach((candidate) => {
            if (candidate.depends_on.includes(currentCode) && next.has(candidate.code)) queue.push(candidate.code);
          });
        }
      }
      return next;
    });
  };

  const validationError = () => {
    if (panel === "identity" && (!form.name.trim() || !form.slug.trim())) return "Institute name and portal slug are required.";
    if (form.slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim().toLowerCase())) return "Portal slug can use lowercase letters, numbers and hyphens only.";
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Please enter a valid institute email.";
    const academicAny = form.academicYearName.trim() || form.academicYearStartDate || form.academicYearEndDate;
    if (panel === "academic" && academicAny && (!form.academicYearName.trim() || !form.academicYearStartDate || !form.academicYearEndDate)) return "Academic year name, start date and end date are required together.";
    if (form.academicYearStartDate && form.academicYearEndDate && form.academicYearEndDate < form.academicYearStartDate) return "Academic year end date must be on or after the start date.";
    if (form.customRequestTitle.trim() !== "" && form.customRequestDescription.trim() === "") return "Add a description for the custom feature request.";
    if (form.customRequestTitle.trim() === "" && form.customRequestDescription.trim() !== "") return "Add a title for the custom feature request.";
    if (!enabledFeatures.size) return "Enable at least one platform feature.";
    return "";
  };

  const moveTo = (next: PanelKey) => {
    const issue = validationError();
    if (issue && panel === "identity" && next !== "identity") {
      setError(issue);
      return;
    }
    setError("");
    setNotice("");
    setPanel(next);
  };

  const createInstitute = async () => {
    const issue = validationError();
    if (issue) {
      setError(issue);
      return;
    }
    if (!enabledFeatures.size) {
      setError("Enable at least one platform feature.");
      setPanel("features");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await supabase.rpc("platform_onboard_institute", {
        p_name: form.name.trim(),
        p_slug: slugify(form.slug.trim()),
        p_description: form.description.trim() || null,
        p_institute_type: form.instituteType.trim() || null,
        p_phone: form.phone.trim() || null,
        p_email: form.email.trim().toLowerCase() || null,
        p_website_url: form.websiteUrl.trim() || null,
        p_address_line1: form.addressLine1.trim() || null,
        p_address_line2: form.addressLine2.trim() || null,
        p_city: form.city.trim() || null,
        p_state: form.state.trim() || null,
        p_postal_code: form.postalCode.trim() || null,
        p_country: form.country.trim() || "India",
        p_timezone: form.timezone.trim() || "Asia/Kolkata",
        p_locale: form.locale.trim() || "en-IN",
        p_logo_url: form.logoUrl.trim() || null,
        p_cover_image_url: form.coverImageUrl.trim() || null,
        p_favicon_url: form.faviconUrl.trim() || null,
        p_logo_alt_text: form.logoAltText.trim() || null,
        p_primary_color: form.primaryColor.trim() || null,
        p_secondary_color: form.secondaryColor.trim() || null,
        p_login_title: form.loginTitle.trim() || null,
        p_powered_by_enabled: form.poweredByEnabled,
        p_academic_year_name: form.academicYearName.trim() || null,
        p_academic_year_start_date: form.academicYearStartDate || null,
        p_academic_year_end_date: form.academicYearEndDate || null,
        p_enabled_features: Array.from(enabledFeatures),
        p_custom_request_title: form.customRequestTitle.trim() || null,
        p_custom_request_description: form.customRequestDescription.trim() || null,
        p_hostname: form.hostname.trim().toLowerCase() || null,
      });
      if (result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row?.institute_id) throw new Error("The onboarding transaction returned no institute ID.");

      setCreated({
        name: String(row.institute_name || form.name),
        slug: String(row.institute_slug || slugify(form.slug)),
        status: String(row.institute_status || "trial"),
        enabled: Number(row.enabled_feature_count || enabledFeatures.size),
        domain: row.domain_hostname ? String(row.domain_hostname) : null,
        token: row.verification_token ? String(row.verification_token) : null,
      });
      setNotice("Institute created successfully. Its complete tenant configuration is now stored.");
      setPanel("review");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create the institute.");
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = enabledFeatures.size;
  const defaultPreview = defaultSubdomainsEnabled && platformDomain && form.slug.trim()
    ? slugify(form.slug.trim()) + "." + platformDomain
    : "";

  return (
    <>
      <style>{`
        .lg-onboarding-overlay{position:fixed;inset:0;background:rgba(15,23,42,.62);display:grid;place-items:center;padding:18px;z-index:1400}
        .lg-onboarding-shell{width:min(1120px,100%);height:min(850px,94vh);display:grid;grid-template-columns:245px minmax(0,1fr);background:#f7f9fc;border-radius:26px;overflow:hidden;box-shadow:0 35px 100px rgba(15,23,42,.3)}
        .lg-onboarding-nav{background:linear-gradient(165deg,#17124d,#3224a6);color:#fff;padding:20px 14px;display:flex;flex-direction:column;min-width:0}
        .lg-onboarding-nav-item{border:0;background:transparent;color:rgba(255,255,255,.72);text-align:left;border-radius:14px;padding:11px 12px;margin-top:5px;cursor:pointer}
        .lg-onboarding-nav-item[data-active=true]{background:rgba(255,255,255,.14);color:#fff;box-shadow:inset 3px 0 0 rgba(255,255,255,.9)}
        .lg-onboarding-content{min-width:0;display:flex;flex-direction:column}
        .lg-onboarding-scroll{overflow:auto;padding:24px}
        .lg-onboarding-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .lg-onboarding-feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:11px}
        .lg-onboarding-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        @media(max-width:780px){
          .lg-onboarding-shell{grid-template-columns:1fr;height:96vh}
          .lg-onboarding-nav{padding:10px;display:block;overflow-x:auto;white-space:nowrap}
          .lg-onboarding-nav-title,.lg-onboarding-nav-sub{display:none}
          .lg-onboarding-nav-list{display:flex;gap:6px}
          .lg-onboarding-nav-item{display:inline-flex;margin:0;padding:9px 11px}
          .lg-onboarding-content{min-height:0}
          .lg-onboarding-grid,.lg-onboarding-summary-grid{grid-template-columns:1fr}
        }
      `}</style>

      <div className="lg-onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="lg-onboarding-title">
        <div className="lg-onboarding-shell">
          <aside className="lg-onboarding-nav">
            <div style={{ padding: "4px 10px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.4, opacity: .72 }}>LEARNERS GUIDE</div>
              <div id="lg-onboarding-title" style={{ fontSize: 19, fontWeight: 900, marginTop: 4 }}>Institute onboarding</div>
              <div className="lg-onboarding-nav-sub" style={{ fontSize: 11, opacity: .66, marginTop: 4 }}>Configure the tenant as a whole.</div>
            </div>
            <div className="lg-onboarding-nav-list">
              {PANELS.map(([key, title, subtitle], index) => (
                <button
                  type="button"
                  key={key}
                  className="lg-onboarding-nav-item"
                  data-active={panel === key}
                  onClick={() => moveTo(key)}
                  disabled={loading}
                >
                  <span style={{ display: "inline-flex", width: 25, height: 25, borderRadius: 999, background: "rgba(255,255,255,.12)", alignItems: "center", justifyContent: "center", marginRight: 9, fontSize: 10, fontWeight: 900 }}>{index + 1}</span>
                  <span style={{ display: "inline-block", verticalAlign: "middle" }}>
                    <strong style={{ display: "block", fontSize: 11 }}>{title}</strong>
                    <span className="lg-onboarding-nav-sub" style={{ display: "block", fontSize: 9, opacity: .62, marginTop: 2 }}>{subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: "auto", padding: 10, borderRadius: 14, background: "rgba(255,255,255,.08)", fontSize: 10, lineHeight: 1.45, opacity: .75 }}>
              You can jump between panels at any time. Final creation is one protected transaction.
            </div>
          </aside>

          <section className="lg-onboarding-content">
            <header style={{ padding: "18px 24px", borderBottom: "1px solid #e4e8f0", background: "#fff", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 900, color: "#4f46e5", letterSpacing: 1.2 }}>{(PANELS.findIndex((x) => x[0] === panel) + 1)} / {PANELS.length}</div>
                <h2 style={{ margin: "4px 0 2px", fontSize: 23 }}>{PANELS.find((x) => x[0] === panel)?.[1]}</h2>
                <div style={{ fontSize: 11, color: "#64748b" }}>{PANELS.find((x) => x[0] === panel)?.[2]}</div>
              </div>
              {!created && <button type="button" style={button(false)} onClick={() => { reset(); onClose(); }} disabled={loading}>Close</button>}
            </header>

            <div className="lg-onboarding-scroll">
              {error && <div role="alert" style={{ marginBottom: 12, padding: 11, borderRadius: 11, background: "#fff1f2", border: "1px solid #fecdd3", color: "#b42318", fontSize: 12 }}>{error}</div>}
              {notice && <div style={{ marginBottom: 12, padding: 11, borderRadius: 11, background: "#ecfdf3", border: "1px solid #bbf7d0", color: "#027a48", fontSize: 12 }}>{notice}</div>}

              {created ? (
                <section style={{ background: "#fff", border: "1px solid #dfe6ef", borderRadius: 20, padding: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#067647", letterSpacing: 1.2 }}>ONBOARDING COMPLETE</div>
                  <h2 style={{ margin: "6px 0" }}>{created.name}</h2>
                  <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>The tenant was created as <b>{created.status}</b> with {created.enabled} enabled feature{created.enabled === 1 ? "" : "s"}.</p>
                  <div className="lg-onboarding-summary-grid" style={{ marginTop: 16 }}>
                    <div style={{ padding: 14, borderRadius: 14, background: "#f8fafc" }}><div style={{ fontSize: 10, color: "#64748b" }}>Portal slug</div><b>{created.slug}</b></div>
                    <div style={{ padding: 14, borderRadius: 14, background: "#f8fafc" }}><div style={{ fontSize: 10, color: "#64748b" }}>Portal domain</div><b>{created.domain || "Configure later"}</b></div>
                  </div>
                  {created.token && created.domain && (
                    <div style={{ marginTop: 14, padding: 14, borderRadius: 14, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
                      <b style={{ fontSize: 12 }}>Custom-domain DNS token</b>
                      <div style={{ marginTop: 5, fontSize: 11 }}>Create the TXT record for <code>_mahin-verification</code> on the registered hostname using this value:</div>
                      <code style={{ display: "block", marginTop: 9, padding: 10, background: "#fff", borderRadius: 10, wordBreak: "break-all" }}>{created.token}</code>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                    <button type="button" style={button(true)} onClick={() => { reset(); onClose(); }}>Done</button>
                  </div>
                </section>
              ) : (
                <>
                  {panel === "identity" && (
                    <section>
                      <div className="lg-onboarding-grid">
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>Institute name
                          <input autoFocus value={form.name} onChange={(e) => { setField("name", e.target.value); if (!form.slug) setField("slug", slugify(e.target.value)); }} placeholder="ABC Academy" style={{ ...inputStyle, marginTop: 5 }} />
                        </label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Portal slug
                          <input value={form.slug} onChange={(e) => setField("slug", slugify(e.target.value))} placeholder="abc-academy" style={{ ...inputStyle, marginTop: 5 }} />
                        </label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Institute type
                          <select value={form.instituteType} onChange={(e) => setField("instituteType", e.target.value)} style={{ ...inputStyle, marginTop: 5 }}>
                            <option>Coaching Institute</option><option>School</option><option>College</option><option>Training Center</option><option>Tutorial Center</option><option>Other</option>
                          </select>
                        </label>
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>Description
                          <textarea value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Tell students and parents what this institute is about…" rows={6} maxLength={2000} style={{ ...inputStyle, marginTop: 5, resize: "vertical" }} />
                        </label>
                      </div>
                    </section>
                  )}

                  {panel === "contact" && (
                    <section>
                      <div className="lg-onboarding-grid">
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Phone<input value={form.phone} onChange={(e) => setField("phone", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Email<input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>Website<input value={form.websiteUrl} onChange={(e) => setField("websiteUrl", e.target.value)} placeholder="https://example.com" style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>Address line 1<input value={form.addressLine1} onChange={(e) => setField("addressLine1", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>Address line 2<input value={form.addressLine2} onChange={(e) => setField("addressLine2", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>City<input value={form.city} onChange={(e) => setField("city", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>State / region<input value={form.state} onChange={(e) => setField("state", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Postal code<input value={form.postalCode} onChange={(e) => setField("postalCode", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Country<input value={form.country} onChange={(e) => setField("country", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Timezone<select value={form.timezone} onChange={(e) => setField("timezone", e.target.value)} style={{ ...inputStyle, marginTop: 5 }}><option>Asia/Kolkata</option><option>UTC</option><option>Asia/Dubai</option><option>Asia/Singapore</option></select></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Locale<select value={form.locale} onChange={(e) => setField("locale", e.target.value)} style={{ ...inputStyle, marginTop: 5 }}><option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="hi-IN">Hindi (India)</option><option value="gu-IN">Gujarati (India)</option></select></label>
                      </div>
                    </section>
                  )}

                  {panel === "branding" && (
                    <section>
                      <div className="lg-onboarding-grid">
                        <div style={{ gridColumn: "1 / -1", padding: 14, border: "1px solid #dfe6ef", borderRadius: 16, background: "#fff" }}>
                          <div style={{ fontSize: 12, fontWeight: 900 }}>Logo</div>
                          <div style={{ marginTop: 4, fontSize: 10, color: "#64748b" }}>Upload a PNG, JPG, WEBP or SVG-style image up to 5 MB, or paste an existing public URL.</div>
                          <input type="file" accept="image/*" disabled={!draftId || !!uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAsset("logo", file); e.currentTarget.value = ""; }} style={{ marginTop: 10, maxWidth: "100%" }} />
                          <input value={form.logoUrl} onChange={(e) => setField("logoUrl", e.target.value)} placeholder="https://…" style={{ ...inputStyle, marginTop: 8 }} />
                          {form.logoUrl && <img src={form.logoUrl} alt={form.logoAltText || "Institute logo preview"} style={{ marginTop: 10, width: 86, height: 86, objectFit: "contain", borderRadius: 14, border: "1px solid #e2e8f0", background: "#fff" }} />}
                        </div>
                        <div style={{ gridColumn: "1 / -1", padding: 14, border: "1px solid #dfe6ef", borderRadius: 16, background: "#fff" }}>
                          <div style={{ fontSize: 12, fontWeight: 900 }}>Cover image</div>
                          <input type="file" accept="image/*" disabled={!draftId || !!uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAsset("cover", file); e.currentTarget.value = ""; }} style={{ marginTop: 10, maxWidth: "100%" }} />
                          <input value={form.coverImageUrl} onChange={(e) => setField("coverImageUrl", e.target.value)} placeholder="https://…" style={{ ...inputStyle, marginTop: 8 }} />
                          {form.coverImageUrl && <img src={form.coverImageUrl} alt="" style={{ marginTop: 10, width: "100%", maxHeight: 130, objectFit: "cover", borderRadius: 14, border: "1px solid #e2e8f0" }} />}
                        </div>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Logo alt text<input value={form.logoAltText} onChange={(e) => setField("logoAltText", e.target.value)} placeholder="ABC Academy logo" style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Favicon URL<input value={form.faviconUrl} onChange={(e) => setField("faviconUrl", e.target.value)} placeholder="https://…" style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Primary color<input value={form.primaryColor} onChange={(e) => setField("primaryColor", e.target.value)} placeholder="#4F46E5" style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Secondary color<input value={form.secondaryColor} onChange={(e) => setField("secondaryColor", e.target.value)} placeholder="#111827" style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>Login title<input value={form.loginTitle} onChange={(e) => setField("loginTitle", e.target.value)} placeholder="Welcome to ABC Academy" style={{ ...inputStyle, marginTop: 5 }} /></label>
                      </div>
                      <label style={{ marginTop: 14, display: "flex", gap: 9, alignItems: "center", fontSize: 12, fontWeight: 800 }}><input type="checkbox" checked={form.poweredByEnabled} onChange={(e) => setField("poweredByEnabled", e.target.checked)} /> Show Learners Guide powered-by branding</label>
                      {uploading && <div style={{ marginTop: 10, color: "#4f46e5", fontSize: 11, fontWeight: 800 }}>Uploading {uploading}…</div>}
                    </section>
                  )}

                  {panel === "academic" && (
                    <section>
                      <div style={{ padding: 15, borderRadius: 15, background: "#eef2ff", color: "#3730a3", fontSize: 12, lineHeight: 1.5 }}>Academic setup is optional. Add the first academic year now, or leave all three fields empty and configure it later from the institute admin portal.</div>
                      <div className="lg-onboarding-grid" style={{ marginTop: 14 }}>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Academic year name<input value={form.academicYearName} onChange={(e) => setField("academicYearName", e.target.value)} placeholder="2026–27" style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <div />
                        <label style={{ fontSize: 11, fontWeight: 900 }}>Start date<input type="date" value={form.academicYearStartDate} onChange={(e) => setField("academicYearStartDate", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ fontSize: 11, fontWeight: 900 }}>End date<input type="date" value={form.academicYearEndDate} onChange={(e) => setField("academicYearEndDate", e.target.value)} style={{ ...inputStyle, marginTop: 5 }} /></label>
                      </div>
                    </section>
                  )}

                  {panel === "features" && (
                    <section>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <div>
                          <b>{selectedCount} of {features.length || "…"} features enabled</b>
                          <div style={{ marginTop: 3, color: "#64748b", fontSize: 11 }}>Turning on a feature also turns on its dependencies. Turning one off also disables anything that depends on it.</div>
                        </div>
                        <div style={{ display: "flex", gap: 7 }}>
                          <button type="button" style={button(false)} disabled={featureLoading} onClick={() => setEnabledFeatures(new Set(features.map((feature) => feature.code)))}>Enable all</button>
                          <button type="button" style={button(false)} disabled={featureLoading} onClick={() => setEnabledFeatures(new Set())}>Disable all</button>
                        </div>
                      </div>
                      {featureLoading ? <div style={{ padding: 24, color: "#64748b" }}>Loading platform features…</div> : (
                        groupedFeatures.map(([category, items]) => (
                          <div key={category} style={{ marginTop: 17 }}>
                            <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b", letterSpacing: 1 }}>{labelForCategory(category)}</div>
                            <div className="lg-onboarding-feature-grid" style={{ marginTop: 8 }}>
                              {items.map((feature) => {
                                const on = enabledFeatures.has(feature.code);
                                return (
                                  <div key={feature.code} style={{ border: "1px solid " + (on ? "#c7d2fe" : "#e3e8ef"), borderRadius: 16, padding: 14, background: on ? "#fbfcff" : "#f8fafc" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                      <div>
                                        <b style={{ fontSize: 13 }}>{feature.name}</b>
                                        <div style={{ marginTop: 3, fontSize: 9, fontWeight: 900, color: "#7c3aed" }}>{feature.code}</div>
                                      </div>
                                      <button type="button" aria-pressed={on} onClick={() => toggleFeature(feature.code, !on)} style={{ border: 0, borderRadius: 999, padding: "6px 10px", fontWeight: 900, cursor: "pointer", background: on ? "#dcfce7" : "#e2e8f0", color: on ? "#166534" : "#475569" }}>{on ? "ON" : "OFF"}</button>
                                    </div>
                                    <p style={{ margin: "9px 0 0", fontSize: 11, lineHeight: 1.45, color: "#64748b" }}>{feature.description}</p>
                                    {feature.depends_on.length > 0 && <div style={{ marginTop: 8, fontSize: 9, color: "#94a3b8" }}>Needs: {feature.depends_on.map((code) => featureByCode.get(code)?.name || code).join(", ")}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </section>
                  )}

                  {panel === "domain" && (
                    <section>
                      <div style={{ padding: 15, borderRadius: 15, background: "#f8fafc", border: "1px solid #e5e9f0", fontSize: 12, lineHeight: 1.55 }}>
                        {defaultPreview ? <><b>Platform portal:</b> {defaultPreview}<br /><span style={{ color: "#64748b", fontSize: 10 }}>This is created automatically only when the platform default domain and automatic subdomains are configured.</span></> : <><b>No automatic platform domain is currently available.</b><br /><span style={{ color: "#64748b", fontSize: 10 }}>A custom domain can still be registered below and verified after creation.</span></>}
                      </div>
                      <label style={{ display: "block", marginTop: 14, fontSize: 11, fontWeight: 900 }}>Custom domain <span style={{ color: "#64748b", fontWeight: 500 }}>(optional)</span>
                        <input value={form.hostname} onChange={(e) => setField("hostname", e.target.value)} placeholder="academy.example.com" style={{ ...inputStyle, marginTop: 5 }} />
                      </label>
                      <div style={{ marginTop: 12, padding: 12, borderRadius: 13, background: "#fffbeb", color: "#92400e", fontSize: 10 }}>Custom domains remain pending until DNS verification and TLS are completed.</div>
                    </section>
                  )}

                  {panel === "custom" && (
                    <section>
                      <div style={{ padding: 15, borderRadius: 15, background: "#f8fafc", border: "1px solid #e5e9f0", fontSize: 12, lineHeight: 1.5 }}>
                        Custom requests go into the platform delivery queue. The feature can later be developed as a versioned platform module and enabled only for this institute.
                      </div>
                      <div className="lg-onboarding-grid" style={{ marginTop: 14 }}>
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>Custom feature title<input value={form.customRequestTitle} onChange={(e) => setField("customRequestTitle", e.target.value)} placeholder="Bus tracking" style={{ ...inputStyle, marginTop: 5 }} /></label>
                        <label style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 900 }}>What should it do?<textarea value={form.customRequestDescription} onChange={(e) => setField("customRequestDescription", e.target.value)} placeholder="Describe the workflow, who uses it, and what the institute needs." rows={8} style={{ ...inputStyle, marginTop: 5, resize: "vertical" }} /></label>
                      </div>
                    </section>
                  )}

                  {panel === "review" && (
                    <section>
                      <div style={{ display: "grid", gap: 11 }}>
                        {[
                          ["Institute", form.name || "—", (form.instituteType || "—") + " · " + (slugify(form.slug) || "no-slug")],
                          ["Contact", form.email || "—", form.phone || "No phone"],
                          ["Location", [form.addressLine1, form.city, form.state, form.country].filter(Boolean).join(", ") || "Not provided", form.websiteUrl || "No website"],
                          ["Branding", form.logoUrl ? "Logo configured" : "No logo", form.primaryColor || "Default colors"],
                          ["Academic", form.academicYearName || "Configure later", form.academicYearStartDate && form.academicYearEndDate ? form.academicYearStartDate + " → " + form.academicYearEndDate : "No initial year"],
                          ["Features", selectedCount + " enabled", Array.from(enabledFeatures).map((code) => featureByCode.get(code)?.name || code).join(", ") || "None"],
                          ["Portal", defaultPreview || "No automatic platform portal", form.hostname || "No custom domain"],
                          ["Custom", form.customRequestTitle || "No custom request", form.customRequestDescription ? "Request will be queued" : "—"],
                        ].map(([title, main, meta]) => (
                          <div key={title} style={{ padding: 14, borderRadius: 15, border: "1px solid #e5e9f0", background: "#fff" }}>
                            <div style={{ fontSize: 10, fontWeight: 900, color: "#64748b" }}>{title.toUpperCase()}</div>
                            <div style={{ marginTop: 4, fontWeight: 900, fontSize: 14 }}>{main}</div>
                            <div style={{ marginTop: 3, color: "#64748b", fontSize: 10, lineHeight: 1.45 }}>{meta}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 14, padding: 14, borderRadius: 15, background: "#eef2ff", color: "#3730a3", fontSize: 11, lineHeight: 1.5 }}>
                        Creation is atomic: the institute profile, settings, role defaults, feature entitlements, optional academic year, optional domain and optional custom request are committed together.
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            {!created && (
              <footer style={{ padding: "15px 24px", borderTop: "1px solid #e4e8f0", background: "#fff", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <button type="button" style={button(false)} onClick={() => { const index = PANELS.findIndex((x) => x[0] === panel); setPanel(PANELS[Math.max(0, index - 1)][0] as PanelKey); setError(""); }} disabled={loading || panel === "identity"}>← Previous</button>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {panel !== "review" && <button type="button" style={button(false)} onClick={() => { const index = PANELS.findIndex((x) => x[0] === panel); setPanel(PANELS[Math.min(PANELS.length - 1, index + 1)][0] as PanelKey); setError(validationError()); }}>Next panel →</button>}
                  {panel === "review" && <button type="button" style={button(true)} disabled={loading || !!uploading} onClick={() => void createInstitute()}>{loading ? "Creating institute…" : "Create institute"}</button>}
                </div>
              </footer>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
