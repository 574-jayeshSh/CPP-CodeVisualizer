import { useEffect, useState } from "react";

const RAILS = [
  { num: "01", name: "Lex" },
  { num: "02", name: "Parse" },
  { num: "03", name: "Semantic" },
  { num: "04", name: "Codegen" },
  { num: "05", name: "Run" },
] as const;

// Plays once per document load; SPA route changes back to the landing
// page within the same tab do not replay it.
let introPlayedThisDocument = false;

const EXIT_AT_MS = 2600;
const UNMOUNT_AT_MS = 3350;

function IntroLoader() {
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);

  const shouldPlay =
    !introPlayedThisDocument &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!shouldPlay) return;

    introPlayedThisDocument = true;
    document.documentElement.classList.add("intro-active");
    document.body.style.overflow = "hidden";

    const release = () => {
      document.documentElement.classList.remove("intro-active");
      document.body.style.overflow = "";
    };

    const exitTimer = setTimeout(() => setExiting(true), EXIT_AT_MS);
    const doneTimer = setTimeout(() => {
      release();
      setDone(true);
    }, UNMOUNT_AT_MS);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
      release();
    };
  }, [shouldPlay]);

  if (!shouldPlay || done) return null;

  return (
    <div className={`intro-loader${exiting ? " is-exiting" : ""}`} aria-hidden="true">
      <div className="intro-grid" />
      <span className="intro-bracket intro-bracket-tl" />
      <span className="intro-bracket intro-bracket-tr" />
      <span className="intro-bracket intro-bracket-bl" />
      <span className="intro-bracket intro-bracket-br" />

      <div className="intro-center">
        <div className="intro-words">
          <span className="intro-word intro-word-1">SOURCE.</span>
          <span className="intro-word intro-word-2">ASSEMBLY.</span>
        </div>
        <p className="intro-tag">From source, to assembly.</p>
      </div>

      <div className="intro-rails">
        {RAILS.map((rail, index) => (
          <div className="intro-rail" key={rail.num}>
            <div className="intro-rail-label">
              <span className="intro-rail-num">{rail.num}</span>
              <span className="intro-rail-name">{rail.name}</span>
            </div>
            <div className="intro-rail-track">
              <span
                className="intro-rail-fill"
                style={{ animationDelay: `${0.45 + index * 0.38}s` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { IntroLoader };
