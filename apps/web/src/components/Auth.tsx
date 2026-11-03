import { useState, type FormEvent } from "react";

import type { AuthResponse, UserDto } from "@codelens/shared";

import { api, ApiRequestError } from "../api";

interface AuthPanelProps {
  user: UserDto | null;
  onAuthed: (response: AuthResponse) => void;
  onLogout: () => void;
}

type Mode = "login" | "register";

export function AuthPanel({ user, onAuthed, onLogout }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return (
      <div className="auth auth-user">
        <div className="auth-user-name">{user.name}</div>
        <div className="auth-user-email">{user.email}</div>
        <button type="button" className="btn btn-ghost" onClick={onLogout}>
          Sign out
        </button>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response =
        mode === "login"
          ? await api.login({ email, password })
          : await api.register({ email, name, password });

      onAuthed(response);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth" onSubmit={submit}>
      <div className="auth-tabs">
        <button
          type="button"
          className={`auth-tab${mode === "login" ? " is-active" : ""}`}
          onClick={() => setMode("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`auth-tab${mode === "register" ? " is-active" : ""}`}
          onClick={() => setMode("register")}
        >
          Register
        </button>
      </div>

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          required
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      {mode === "register" && (
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            required
            maxLength={80}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      )}

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          required
          minLength={mode === "register" ? 8 : 1}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {error && <div className="form-error">{error}</div>}

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
