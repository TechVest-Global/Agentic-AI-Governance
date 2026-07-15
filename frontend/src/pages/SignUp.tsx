import { useState, useCallback } from "react";
import { Shield, Eye, EyeOff, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeStore } from "@/store/useThemeStore";
import { API_BASE_URL } from "@/api/governanceApi";

function sanitizeInput(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 256);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

type PasswordStrength = { score: number; label: string; color: string };

function getPasswordStrength(pw: string): PasswordStrength {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: "Weak",   color: "bg-red-500"    };
  if (score <= 2) return { score, label: "Fair",   color: "bg-orange-400" };
  if (score <= 3) return { score, label: "Good",   color: "bg-yellow-400" };
  if (score <= 4) return { score, label: "Strong", color: "bg-brand-500"  };
  return              { score, label: "Very strong", color: "bg-brand-600" };
}

type Fields = {
  name: string;
  email: string;
  password: string;
  confirm: string;
  role: string;
};

type FieldErrors = Partial<Record<keyof Fields, string>>;

export function SignUp({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const signIn = useAuthStore((s) => s.signIn);
  const { theme, toggleTheme } = useThemeStore();

  const [fields, setFields] = useState<Fields>({ name: "", email: "", password: "", confirm: "", role: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [loading, setLoading]  = useState(false);
  const [error, setError]      = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [agreed, setAgreed]    = useState(false);

  const strength = getPasswordStrength(fields.password);

  const setField = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFields((prev) => ({ ...prev, [key]: sanitizeInput(e.target.value) }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    setError(null);
  };

  const validate = useCallback((): boolean => {
    const errs: FieldErrors = {};
    const nameClean = fields.name.trim();

    if (!nameClean) {
      errs.name = "Full name is required.";
    } else if (nameClean.length < 2) {
      errs.name = "Name must be at least 2 characters.";
    } else if (!/^[\p{L}\s'\-]+$/u.test(nameClean)) {
      errs.name = "Name contains invalid characters.";
    }

    if (!fields.email.trim()) {
      errs.email = "Work email is required.";
    } else if (!isValidEmail(fields.email)) {
      errs.email = "Enter a valid email address.";
    }

    if (!fields.password) {
      errs.password = "Password is required.";
    } else if (fields.password.length < 8) {
      errs.password = "Password must be at least 8 characters.";
    } else if (strength.score < 2) {
      errs.password = "Password is too weak. Add uppercase letters, numbers, or symbols.";
    }

    if (!fields.confirm) {
      errs.confirm = "Please confirm your password.";
    } else if (fields.confirm !== fields.password) {
      errs.confirm = "Passwords do not match.";
    }

    if (!fields.role) errs.role = "Please select your role.";

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }, [fields, strength.score]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!agreed) {
      setError("You must agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }

    if (!validate()) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/sign-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name.trim(),
          email: fields.email.toLowerCase().trim(),
          role: fields.role,
          password: fields.password,
        }),
      });

      if (!response.ok) {
        setError("Registration failed. Please try again or contact support.");
        return;
      }

      const { user, token } = await response.json();
      signIn(user, token);
    } catch {
      setError("Registration failed. Please try again or contact support.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (field: keyof Fields) =>
    `w-full rounded-lg border ${
      fieldErrors[field]
        ? "border-red-400 dark:border-red-600"
        : "border-slate-300 dark:border-slate-600"
    } bg-white dark:bg-slate-800 px-3.5 py-2.5 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-700/40`;

  const label = (text: string, htmlFor: string) => (
    <label htmlFor={htmlFor} className="block text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
      {text}
    </label>
  );

  const fieldErr = (key: keyof Fields, id: string) =>
    fieldErrors[key] ? (
      <p id={id} role="alert" className="mt-1.5 text-[11.5px] text-red-600 dark:text-red-400">
        {fieldErrors[key]}
      </p>
    ) : null;

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
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px] animate-fade-in">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-8 shadow-[0_8px_32px_-8px_rgba(16,24,40,0.12)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]">
            <div className="mb-7 text-center">
              <h1 className="text-[22px] font-semibold text-slate-900 dark:text-white leading-tight">Create your account</h1>
              <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">Start governing AI with confidence</p>
            </div>

            {error && (
              <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-3 text-[12.5px] text-red-700 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate autoComplete="on" className="space-y-4">
              {/* full name */}
              <div>
                {label("Full name", "signup-name")}
                <input
                  id="signup-name"
                  type="text"
                  name="name"
                  autoComplete="name"
                  value={fields.name}
                  onChange={setField("name")}
                  aria-invalid={!!fieldErrors.name}
                  aria-describedby={fieldErrors.name ? "name-err" : undefined}
                  placeholder="Jane Smith"
                  className={inputClass("name")}
                />
                {fieldErr("name", "name-err")}
              </div>

              {/* email */}
              <div>
                {label("Work email", "signup-email")}
                <input
                  id="signup-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={fields.email}
                  onChange={setField("email")}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-err" : undefined}
                  placeholder="jane@company.com"
                  className={inputClass("email")}
                />
                {fieldErr("email", "email-err")}
              </div>

              {/* role */}
              <div>
                {label("Your role", "signup-role")}
                <select
                  id="signup-role"
                  name="role"
                  value={fields.role}
                  onChange={setField("role")}
                  aria-invalid={!!fieldErrors.role}
                  className={`${inputClass("role")} cursor-pointer`}
                >
                  <option value="">Select a role…</option>
                  <option value="Compliance Lead">Compliance Lead</option>
                  <option value="AI Risk Officer">AI Risk Officer</option>
                  <option value="Data Scientist">Data Scientist</option>
                  <option value="ML Engineer">ML Engineer</option>
                  <option value="Developer">Developer</option>
                  <option value="Legal Counsel">Legal Counsel</option>
                  <option value="Auditor">Auditor</option>
                  <option value="Administrator">Administrator</option>
                </select>
                {fieldErr("role", "role-err")}
              </div>

              {/* password */}
              <div>
                {label("Password", "signup-password")}
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    name="new-password"
                    autoComplete="new-password"
                    value={fields.password}
                    onChange={setField("password")}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby="pw-strength pw-err"
                    placeholder="Min 8 characters"
                    className={`${inputClass("password")} pr-10`}
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
                {fields.password && (
                  <div id="pw-strength" className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                            i <= strength.score ? strength.color : "bg-slate-200 dark:bg-slate-700"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Strength: <span className="font-medium text-slate-700 dark:text-slate-300">{strength.label}</span>
                    </p>
                  </div>
                )}
                {fieldErr("password", "pw-err")}
              </div>

              {/* confirm */}
              <div>
                {label("Confirm password", "signup-confirm")}
                <div className="relative">
                  <input
                    id="signup-confirm"
                    type={showConfirm ? "text" : "password"}
                    name="confirm-password"
                    autoComplete="new-password"
                    value={fields.confirm}
                    onChange={setField("confirm")}
                    aria-invalid={!!fieldErrors.confirm}
                    aria-describedby={fieldErrors.confirm ? "confirm-err" : undefined}
                    placeholder="Repeat password"
                    className={`${inputClass("confirm")} pr-10`}
                  />
                  {fields.confirm && fields.confirm === fields.password && (
                    <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-500" />
                  )}
                  {(!fields.confirm || fields.confirm !== fields.password) && (
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {fieldErr("confirm", "confirm-err")}
              </div>

              {/* terms */}
              <div className="flex items-start gap-2.5 pt-1">
                <input
                  id="terms"
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => { setAgreed(e.target.checked); setError(null); }}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 dark:border-slate-600 accent-brand-600 cursor-pointer"
                />
                <label htmlFor="terms" className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed cursor-pointer">
                  I agree to the{" "}
                  <span className="font-medium text-brand-600 dark:text-brand-400 hover:underline cursor-pointer">Terms of Service</span>
                  {" "}and{" "}
                  <span className="font-medium text-brand-600 dark:text-brand-400 hover:underline cursor-pointer">Privacy Policy</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full flex items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>

            <p className="mt-6 text-center text-[12.5px] text-slate-500 dark:text-slate-400">
              Already have an account?{" "}
              <button onClick={onSwitchToSignIn} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline focus:outline-none">
                Sign in
              </button>
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
