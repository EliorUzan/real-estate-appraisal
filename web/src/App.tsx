import type { Session } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { ApiRequestError, apiRequest } from "./lib/api";
import { supabase } from "./lib/supabase";

type View = "new" | "history" | "settings";
type Catalog = {
  sections: Array<{ id: string; label_he: string }>;
  providers: Array<{ id: string; label: string }>;
  limits: Record<string, number>;
};

function Login() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/new` },
    });
    if (signInError) {
      setError("לא ניתן לשלוח קישור התחברות. נסו שוב או פנו למנהל הצוות.");
      return;
    }
    setSubmitted(true);
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">עוזר להערכת מקרקעין</p>
        <h1 id="login-title">כניסה לצוות</h1>
        <p>היסטוריית השומות משותפת לחברי הצוות. מפתחות ה-AI נשמרים פרטיים לכל משתמש.</p>
        {submitted ? (
          <p className="success" role="status">נשלח קישור כניסה לכתובת שסיפקתם. פתחו אותו בדפדפן זה.</p>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="email">כתובת אימייל</label>
            <input id="email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit">שלחו לי קישור כניסה</button>
          </form>
        )}
      </section>
    </main>
  );
}

function NewJob({ session, catalog }: { session: Session; catalog: Catalog | null }) {
  const [address, setAddress] = useState("");
  const [example, setExample] = useState("");
  const [additionalRequest, setAdditionalRequest] = useState("");
  const [provider, setProvider] = useState("openai");
  const [modelId, setModelId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!address.trim() || !modelId.trim()) {
      setError("יש למלא כתובת ומזהה מודל לפני יצירה.");
      return;
    }
    setSubmitting(true);
    try {
      // Workspace selection and direct temporary uploads are wired once the API repository layer is live.
      await apiRequest(session, "/v1/jobs", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          workspace_id: "00000000-0000-0000-0000-000000000000",
          section_id: "environment_description",
          address,
          example,
          additional_request: additionalRequest,
          provider_id: provider,
          model_id: modelId,
          example_attachment_ids: [],
          additional_request_attachment_ids: [],
          consent_version: "provider-transmission-v1",
        }),
      });
      setNotice("הבקשה נשלחה. אפשר להמשיך לעבוד ולהציג את מצבה בהיסטוריה.");
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "לא ניתן ליצור את הבקשה כעת.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="content-card" aria-labelledby="new-job-title">
      <div className="title-row">
        <div>
          <p className="eyebrow">בקשה חדשה</p>
          <h1 id="new-job-title">תיאור סביבת הנכס</h1>
        </div>
        <span className="shared-badge">נשמר בהיסטוריית הצוות</span>
      </div>
      <form className="job-form" onSubmit={submit}>
        <label htmlFor="address">כתובת הנכס</label>
        <input id="address" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} required />
        <label htmlFor="example">דוגמה לסגנון</label>
        <textarea id="example" value={example} onChange={(event) => setExample(event.target.value)} maxLength={20_000} rows={7} />
        <label htmlFor="request">בקשה נוספת</label>
        <textarea id="request" value={additionalRequest} onChange={(event) => setAdditionalRequest(event.target.value)} maxLength={20_000} rows={4} />
        <fieldset className="attachments" disabled>
          <legend>קבצים מצורפים</legend>
          <p>העלאה זמנית ומאובטחת תתווסף לאחר חיבור שכבת השרת. קובצי המקור יימחקו לאחר העיבוד.</p>
        </fieldset>
        <div className="two-columns">
          <label htmlFor="provider">ספק AI
            <select id="provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
              {(catalog?.providers ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label htmlFor="model">מזהה מודל
            <input id="model" dir="ltr" value={modelId} onChange={(event) => setModelId(event.target.value)} required />
          </label>
        </div>
        <p className="privacy-notice">בלחיצה על יצירה, התוכן יישלח רק לספק שנבחר באמצעות המפתח הפרטי שלך. קובצי המקור זמניים.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
        <button type="submit" disabled={submitting}>{submitting ? "שולח…" : "יצירת טיוטה"}</button>
      </form>
    </section>
  );
}

function AppShell({ session }: { session: Session }) {
  const [view, setView] = useState<View>("new");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    apiRequest<Catalog>(session, "/v1/catalog").then(setCatalog).catch(() => {
      setLoadError("לא ניתן לטעון את הגדרות העבודה. נסו לרענן את הדף.");
    });
  }, [session]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="app-shell">
      <header>
        <a className="brand" href="/new">עוזר להערכת מקרקעין</a>
        <nav aria-label="ניווט ראשי">
          <button className={view === "new" ? "nav-active" : ""} onClick={() => setView("new")}>בקשה חדשה</button>
          <button className={view === "history" ? "nav-active" : ""} onClick={() => setView("history")}>היסטוריה</button>
          <button className={view === "settings" ? "nav-active" : ""} onClick={() => setView("settings")}>הגדרות ספקים</button>
        </nav>
        <button className="quiet-button" onClick={signOut}>יציאה</button>
      </header>
      <main className="workspace">
        {loadError && <p className="error" role="alert">{loadError}</p>}
        {view === "new" && <NewJob session={session} catalog={catalog} />}
        {view === "history" && <section className="content-card"><h1>היסטוריית הצוות</h1><p>רשימת בקשות משותפת, גרסאות ואישורים תוצג כאן אחרי חיבור מאגר הנתונים.</p></section>}
        {view === "settings" && <section className="content-card"><h1>הגדרות ספקי AI</h1><p>המפתח של כל משתמש יוצפן בשרת ולא יוצג שוב בדפדפן. מסך השמירה יתווסף עם ממשק ההצפנה.</p></section>}
      </main>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => subscription.subscription.unsubscribe();
  }, []);

  if (loading) return <main className="login-shell"><p>טוען…</p></main>;
  return session ? <AppShell session={session} /> : <Login />;
}
