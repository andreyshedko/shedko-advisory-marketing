"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <section className="login-story">
        <div className="wordmark">
          SHEDKO<span>ADVISORY</span>
        </div>
        <div>
          <span className="eyebrow">MARKETING OPERATIONS</span>
          <h1>
            От первого контакта
            <br />к следующей сделке.
          </h1>
          <p>
            Компании, партнёрства и переговоры.
            <br />В одном рабочем пространстве.
          </p>
        </div>
        <small>INDEPENDENT TECHNOLOGY DUE DILIGENCE</small>
      </section>
      <section className="login-form">
        <ShieldCheck size={28} />
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h2>Вход администратора</h2>
        <p className="muted">Используйте учётную запись Shedko Advisory.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/auth/sign-in/email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: f.get("email"),
                  password: f.get("password"),
                }),
              });
              if (!r.ok)
                throw new Error("Не удалось войти. Проверьте email и пароль.");
              router.push("/");
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Ошибка входа");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={14}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Вход…" : "Войти в рабочую панель"}
            <ArrowRight size={17} />
          </button>
        </form>
        <small className="muted">
          Доступ только для администратора. Регистрация отключена.
        </small>
      </section>
    </main>
  );
}
