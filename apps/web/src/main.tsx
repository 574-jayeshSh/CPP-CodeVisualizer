import { useEffect, type ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import { App } from "./App";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import "./styles.css";
import "./landing.css";

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div key={location.pathname} className="page">
      {children}
    </div>
  );
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route
          path="/"
          element={
            <PageTransition>
              <Landing />
            </PageTransition>
          }
        />
        <Route
          path="/compiler"
          element={
            <PageTransition>
              <App />
            </PageTransition>
          }
        />
        <Route
          path="/login"
          element={
            <PageTransition>
              <Login />
            </PageTransition>
          }
        />
        <Route
          path="*"
          element={
            <PageTransition>
              <Landing />
            </PageTransition>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
