import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const STORAGE_KEY = "scroll-break-state";
const DEFAULT_TEXT =
  "Paste something longer than your patience.\n\nThen read it one small motion at a time.";
const MOVE_LOCK_MS = 620;
const WHEEL_THRESHOLD = 52;
const WHEEL_GESTURE_RESET_MS = 520;
const TRANSITION_MS = 520;

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function splitParagraphIntoSentences(paragraph) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(paragraph))
      .map((segment) => segment.segment.trim())
      .filter(Boolean);
  }

  return paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*)?|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function splitTextIntoSentences(text) {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const sentences = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    sentences.push(...splitParagraphIntoSentences(paragraph));

    if (paragraphIndex < paragraphs.length - 1) {
      sentences.push("");
    }
  });

  return sentences;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function App() {
  const savedState = useMemo(loadSavedState, []);
  const [text, setText] = useState(savedState?.text || DEFAULT_TEXT);
  const [mode, setMode] = useState(savedState?.mode || "compose");
  const [index, setIndex] = useState(savedState?.index || 0);
  const [fontSize, setFontSize] = useState(savedState?.fontSize || 38);
  const [theme, setTheme] = useState(savedState?.theme || "light");
  const [direction, setDirection] = useState("idle");
  const [outgoingSentence, setOutgoingSentence] = useState(null);
  const [animationId, setAnimationId] = useState(0);
  const lastMoveAt = useRef(0);
  const touchStartY = useRef(null);
  const transitionTimer = useRef(null);
  const wheelDelta = useRef(0);
  const wheelGestureActive = useRef(false);
  const wheelResetTimer = useRef(null);
  const isTransitioning = useRef(false);
  const lines = useMemo(() => splitTextIntoSentences(text), [text]);
  const currentIndex = clamp(index, 0, Math.max(lines.length - 1, 0));
  const canRead = lines.length > 0;

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ text, mode, index: currentIndex, fontSize, theme }),
    );
  }, [text, mode, currentIndex, fontSize, theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (currentIndex !== index) {
      setIndex(currentIndex);
    }
  }, [currentIndex, index]);

  useEffect(() => {
    return () => {
      window.clearTimeout(transitionTimer.current);
      window.clearTimeout(wheelResetTimer.current);
    };
  }, []);

  const move = useCallback(
    (step) => {
      if (mode !== "read" || lines.length === 0 || isTransitioning.current) {
        return;
      }

      const now = Date.now();
      if (now - lastMoveAt.current < MOVE_LOCK_MS) {
        return;
      }

      setIndex((value) => {
        const nextIndex = clamp(value + step, 0, lines.length - 1);

        if (nextIndex === value) {
          return value;
        }

        window.clearTimeout(transitionTimer.current);
        lastMoveAt.current = now;
        isTransitioning.current = true;
        setOutgoingSentence(lines[value] || "");
        setDirection(step > 0 ? "next" : "prev");
        setAnimationId((id) => id + 1);

        transitionTimer.current = window.setTimeout(() => {
          setOutgoingSentence(null);
          isTransitioning.current = false;
        }, TRANSITION_MS);

        return nextIndex;
      });
    },
    [lines, mode],
  );

  useEffect(() => {
    function handleKeyDown(event) {
      if (mode !== "read") {
        return;
      }

      if (["ArrowDown", "PageDown", " ", "j"].includes(event.key)) {
        event.preventDefault();
        move(1);
      }

      if (["ArrowUp", "PageUp", "k"].includes(event.key)) {
        event.preventDefault();
        move(-1);
      }

      if (event.key === "Escape") {
        setMode("compose");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, move]);

  useEffect(() => {
    function handleWheel(event) {
      if (mode !== "read") {
        return;
      }

      event.preventDefault();
      wheelDelta.current += event.deltaY;
      window.clearTimeout(wheelResetTimer.current);

      wheelResetTimer.current = window.setTimeout(() => {
        wheelDelta.current = 0;
        wheelGestureActive.current = false;
      }, WHEEL_GESTURE_RESET_MS);

      if (!wheelGestureActive.current && Math.abs(wheelDelta.current) > WHEEL_THRESHOLD) {
        wheelGestureActive.current = true;
        move(event.deltaY > 0 ? 1 : -1);
      }
    }

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [mode, move]);

  function startReading() {
    if (!canRead) {
      return;
    }

    setIndex(0);
    setDirection("next");
    setOutgoingSentence(null);
    isTransitioning.current = false;
    setMode("read");
  }

  function handleTouchStart(event) {
    touchStartY.current = event.touches[0]?.clientY ?? null;
  }

  function handleTouchEnd(event) {
    if (touchStartY.current === null) {
      return;
    }

    const endY = event.changedTouches[0]?.clientY ?? touchStartY.current;
    const distance = touchStartY.current - endY;
    touchStartY.current = null;

    if (Math.abs(distance) > 48) {
      move(distance > 0 ? 1 : -1);
    }
  }

  if (mode === "read") {
    const currentLine = lines[currentIndex] || "";
    const progress = lines.length ? ((currentIndex + 1) / lines.length) * 100 : 0;

    return (
      <main
        className="reader"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        aria-label="Reader"
      >
        <div className="progress-track" aria-hidden="true">
          <div className="progress-bar" style={{ height: `${progress}%` }} />
        </div>

        <div className="reader-actions" aria-label="Reader controls">
          <button className="icon-button" type="button" onClick={() => setMode("compose")} aria-label="Back to editor">
            <span aria-hidden="true">←</span>
          </button>
          <button className="icon-button" type="button" onClick={() => setIndex(0)} aria-label="Restart">
            <span aria-hidden="true">↺</span>
          </button>
        </div>

        <section className="line-stage" aria-live="polite">
          {outgoingSentence !== null && (
            <p
              key={`out-${animationId}`}
              className={`sentence sentence-out ${direction} ${outgoingSentence ? "" : "sentence-break"}`}
              style={{ fontSize: `${fontSize}px` }}
            >
              {outgoingSentence || " "}
            </p>
          )}
          <p
            key={`in-${animationId}`}
            className={`sentence sentence-in ${direction} ${currentLine ? "" : "sentence-break"}`}
            style={{ fontSize: `${fontSize}px` }}
          >
            {currentLine || " "}
          </p>
        </section>

        <div className="reader-footer">
          <span>{currentIndex + 1} / {lines.length}</span>
          <span>{currentLine ? `${currentLine.length} chars` : "paragraph break"}</span>
        </div>

        <button className="tap-zone tap-prev" type="button" onClick={() => move(-1)} aria-label="Previous line" />
        <button className="tap-zone tap-next" type="button" onClick={() => move(1)} aria-label="Next line" />
      </main>
    );
  }

  return (
    <main className="compose">
      <section className="compose-panel">
        <div className="compose-copy">
          <p className="eyebrow">Scroll Break</p>
          <h1>Feed the scroll. Read the text.</h1>
          <p>
            Paste a wall of words, then move through it one line at a time. The page changes only when your thumb asks.
          </p>
        </div>

        <label className="editor-label" htmlFor="source-text">Text</label>
        <textarea
          id="source-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste your essay, article, notes, manifesto, apology, prophecy..."
        />

        <div className="settings-row">
          <label className="range-control">
            <span>Size</span>
            <input
              type="range"
              min="26"
              max="60"
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </label>

          <div className="segmented-control" aria-label="Theme">
            <button
              className={theme === "light" ? "active" : ""}
              type="button"
              onClick={() => setTheme("light")}
            >
              Light
            </button>
            <button
              className={theme === "dark" ? "active" : ""}
              type="button"
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
          </div>
        </div>

        <div className="action-row">
          <p>{lines.length} sentences prepared</p>
          <button className="primary-button" type="button" onClick={startReading} disabled={!canRead}>
            Read
          </button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
