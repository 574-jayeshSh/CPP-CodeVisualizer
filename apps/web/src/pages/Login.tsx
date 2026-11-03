import { Link, useNavigate } from "react-router-dom";

import { getToken } from "../api";
import { AuthPanel } from "../components/Auth";

function Login() {
  const navigate = useNavigate();
  const signedIn = Boolean(getToken());

  return (
    <div className="login-page">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">{"</>"}</span>
            <span className="brand-name">CodeLens</span>
          </Link>

          <div className="lp-nav-actions">
            <Link to="/compiler" className="btn btn-ghost btn-sm">
              Open compiler
            </Link>
          </div>
        </div>
      </header>

      <main className="login-main">
        <div className="login-card">
          <span className="lp-eyebrow">{signedIn ? "Already with us" : "Welcome back"}</span>
          <h1 className="login-title">
            {signedIn ? "You're signed in." : "Sign in to CodeLens"}
          </h1>
          <p className="login-desc">
            {signedIn
              ? "Your projects and saved snippets are waiting in the workspace."
              : "Save projects, keep your snippets, and pick up where you left off."}
          </p>

          {signedIn ? (
            <div className="login-actions">
              <Link to="/compiler" className="btn btn-primary btn-block">
                Open the compiler
              </Link>
              <Link to="/" className="btn btn-ghost btn-block">
                Back to home
              </Link>
            </div>
          ) : (
            <>
              <AuthPanel
                user={null}
                onAuthed={() => navigate("/compiler", { replace: true })}
                onLogout={() => undefined}
              />
              <Link to="/compiler" className="login-guest">
                Continue as guest →
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export { Login };
