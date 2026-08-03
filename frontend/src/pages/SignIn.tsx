import { useState, useRef, useCallback } from "react";
import { Shield, Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeStore } from "@/store/useThemeStore";
import { API_BASE_URL } from "@/api/governanceApi";

// Rate limiting: max 5 attempts per 15 minutes (client-side guard; server enforces the real limit)
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getRateLimitState(): { attempts: number; lockedUntil: number } {
  try {
    const raw = sessionStorage.getItem("governai-signin-rl");
    return raw ? JSON.parse(raw) : { attempts: 0, lockedUntil: 0 };
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
}

function recordFailedAttempt() {
  const state = getRateLimitState();
  const attempts = state.attempts + 1;
  const lockedUntil = attempts >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : state.lockedUntil;
  sessionStorage.setItem("governai-signin-rl", JSON.stringify({ attempts, lockedUntil }));
}

function clearRateLimit() {
  sessionStorage.removeItem("governai-signin-rl");
}

function sanitizeInput(value: string): string {
  // Strip control characters and excessively long strings.
  // eslint-disable-next-line no-control-regex -- matching control characters is this function's entire purpose
  return value.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 256);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

const DEMO_PASSWORD = "GovernAI2025!";
const DEMO_ACCOUNTS = [
  { id: "usr_demo_auditor", email: "auditor@governai.com", name: "M. Okafor", role: "Compliance Lead", initials: "MO", persona: "Auditor" },
  { id: "usr_demo_dev", email: "dev@governai.com", name: "R. Sharma", role: "ML Engineer", initials: "RS", persona: "Engineer" },
] as const;

export function SignIn({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const signIn = useAuthStore((s) => s.signIn);
  const { theme, toggleTheme } = useThemeStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const emailRef = useRef<HTMLInputElement>(null);

  const validate = useCallback((): boolean => {
    const errs: { email?: string; password?: string } = {};
    if (!email.trim()) errs.email = "Email is required.";
    else if (!isValidEmail(email)) errs.email = "Enter a valid email address.";
    if (!password) errs.password = "Password is required.";
    else if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }, [email, password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const rl = getRateLimitState();
    if (rl.lockedUntil > Date.now()) {
      const remaining = Math.ceil((rl.lockedUntil - Date.now()) / 60000);
      setError(`Too many failed attempts. Try again in ${remaining} minute${remaining !== 1 ? "s" : ""}.`);
      return;
    }

    if (!validate()) return;

    setLoading(true);
    try {
      const safeEmail = sanitizeInput(email.toLowerCase().trim());

      // Two demo accounts (auditor@governai.com / dev@governai.com, shared
      // password below) are recognized by the real backend sign-in endpoint,
      // so the "click to autofill" demo credentials keep working exactly as
      // before — they're just verified server-side now instead of in this file.
      const response = await fetch(`${API_BASE_URL}/auth/sign-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: safeEmail, password }),
      });

      if (response.ok) {
        const { user, token } = await response.json();
        clearRateLimit();
        signIn(user, token);
        return;
      }

      recordFailedAttempt();
      const updated = getRateLimitState();
      const remaining = MAX_ATTEMPTS - updated.attempts;
      if (remaining <= 0) {
        setError("Account temporarily locked due to too many failed attempts. Try again in 15 minutes.");
      } else {
        setError(`Invalid email or password. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`);
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f7fb] dark:bg-[#0c1120] transition-colors duration-200">
      {/* top bar */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-brand-600 text-white">
            <Shield className="h-4 w-4" />
          </div>
          <span className="text-[13px] font-semibold text-slate-900 dark:text-white">GovernAI</span>
        </div>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          {theme === "dark" ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
      </div>

      {/* card */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] animate-fade-in">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-8 shadow-[0_8px_32px_-8px_rgba(16,24,40,0.12)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]">
            <div className="mb-7 text-center">
              <h1 className="text-[22px] font-semibold text-slate-900 dark:text-white leading-tight">Welcome back</h1>
              <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">Sign in to your GovernAI workspace</p>
            </div>

            {error && (
              <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-3 text-[12.5px] text-red-700 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate autoComplete="on" className="space-y-4">
              {/* email */}
              <div>
                <label htmlFor="signin-email" className="block text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Work email
                </label>
                <input
                  ref={emailRef}
                  id="signin-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => { setEmail(sanitizeInput(e.target.value)); setFieldErrors((p) => ({ ...p, email: undefined })); setError(null); }}
                  aria-describedby={fieldErrors.email ? "email-err" : undefined}
                  aria-invalid={!!fieldErrors.email}
                  placeholder="you@company.com"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40 aria-[invalid=true]:border-red-400 dark:aria-[invalid=true]:border-red-600"
                />
                {fieldErrors.email && (
                  <p id="email-err" role="alert" className="mt-1.5 text-[11.5px] text-red-600 dark:text-red-400">{fieldErrors.email}</p>
                )}
              </div>

              {/* password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="signin-password" className="text-[12px] font-medium text-slate-700 dark:text-slate-300">
                    Password
                  </label>
                  <button type="button" className="text-[11.5px] font-medium text-brand-600 dark:text-brand-400 hover:underline focus:outline-none">
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="signin-password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(sanitizeInput(e.target.value)); setFieldErrors((p) => ({ ...p, password: undefined })); setError(null); }}
                    aria-describedby={fieldErrors.password ? "pw-err" : undefined}
                    aria-invalid={!!fieldErrors.password}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2.5 pr-10 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40 aria-[invalid=true]:border-red-400 dark:aria-[invalid=true]:border-red-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="pw-err" role="alert" className="mt-1.5 text-[11.5px] text-red-600 dark:text-red-400">{fieldErrors.password}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full flex items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <p className="mt-6 text-center text-[12.5px] text-slate-500 dark:text-slate-400">
              Don't have an account?{" "}
              <button onClick={onSwitchToSignUp} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline focus:outline-none">
                Sign up
              </button>
            </p>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white/60 dark:bg-slate-900/40 p-3">
            <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Demo accounts
            </p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { setEmail(a.email); setPassword(DEMO_PASSWORD); setError(null); setFieldErrors({}); }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">{a.email}</span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                    {a.persona}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400 dark:text-slate-600">
              Password <span className="font-mono">{DEMO_PASSWORD}</span> · click to autofill
            </p>
          </div>
        </div>
      </div>

      {/* footer */}
      <footer className="py-4 text-center text-[11px] text-slate-400 dark:text-slate-600">
        © {new Date().getFullYear()} GovernAI · Output-only AI Governance Engine · All rights reserved
      </footer>
    </div>
  );
}
