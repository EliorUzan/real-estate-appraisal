export type CliProvider = "claude" | "openai" | "gemini";
export type CliConnection = {id:string;provider:CliProvider;status:string;revision:number;available:boolean;lastVerifiedAt?:string|null};
export type CliProviderStatus = {provider:CliProvider;enabled:boolean;reason:string;connection:CliConnection|null};

export const cliProviders:CliProvider[] = ["gemini", "claude", "openai"];
export const cliLabels:Record<CliProvider,string> = {
  gemini: "Google Antigravity",
  openai: "OpenAI Codex",
  claude: "Claude Code",
};

// The catalog stays visible even when there is no connection or the server is offline.
// Missing/failed availability data can never grant permission to submit a job.
export function providerCatalog(statuses:CliProviderStatus[]):CliProviderStatus[] {
  return cliProviders.map(provider => statuses.find(p => p.provider === provider) ?? {
    provider, enabled:false, reason:"STATUS_UNAVAILABLE", connection:null,
  });
}

export function canSubmitCli(provider:CliProviderStatus|undefined, verified:boolean) {
  return verified && provider?.enabled === true && provider.connection?.status === "connected"
    && provider.connection.available === true;
}

export function connectionLabel(provider:CliProviderStatus) {
  if (canSubmitCli(provider, true)) return "זמין לשליחה";
  if (provider.reason === "STATUS_UNAVAILABLE") return "מצב לא זמין";
  const status = provider.connection?.status;
  if (status === "reauth_required") return "נדרשת כניסה מחדש";
  if (status === "disconnecting") return "מתנתק";
  if (!status || status === "disconnected") return "טרם חובר";
  if (provider.reason === "ANTIGRAVITY_ISOLATION_PENDING") return "בדיקות שרת בתהליך";
  if (status === "pending_setup") return "החיבור בהכנה";
  if (status === "disabled" || !provider.enabled) return "אינו זמין כעת";
  return "השרת אינו זמין";
}

export function connectionHelp(provider:CliProviderStatus) {
  if (canSubmitCli(provider, true)) return "החשבון האישי מחובר. אפשר לשלוח בקשה.";
  if (provider.reason === "STATUS_UNAVAILABLE") return "לא ניתן לבדוק את מצב החשבון. נסו לרענן את הזמינות.";
  const status = provider.connection?.status;
  if (status === "reauth_required") return "הכניסה לחשבון פגה. פתחו את ניהול חשבונות CLI ובקשו חיבור מחדש.";
  if (status === "disconnecting") return "ניתוק החשבון מתבצע. המתינו לסיום לפני חיבור מחדש.";
  if (!status || status === "disconnected") return "פתחו את ניהול חשבונות CLI ובקשו חיבור לחשבון האישי שלכם.";
  if (provider.reason === "ANTIGRAVITY_ISOLATION_PENDING") return "חיבור Antigravity ממתין להשלמת בדיקות שרת ההפעלה. אם כבר נכנסתם לחשבון, אין צורך להיכנס שוב בשלב זה. שליחה תתאפשר לאחר השלמת הבדיקות.";
  if (status === "pending_setup") return "בקשת החיבור התקבלה. יש להשלים כניסה רשמית ובדיקת החיבור בסיוע המפעיל.";
  if (status === "disabled" || !provider.enabled) return "סביבת ההפעלה אינה מוכנה כרגע. המפעיל צריך להשלים את בדיקתה.";
  return "החשבון מחובר, אך שרת ההפעלה אינו זמין כרגע. נסו לרענן את הזמינות.";
}
