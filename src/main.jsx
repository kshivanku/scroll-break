import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const STORAGE_KEY = "scroll-break-state";
const DEFAULT_TEXT =
  "Paste something longer than your patience.\n\nThen read it one small motion at a time.";
const MOVE_LOCK_MS = 540;
const WHEEL_THRESHOLD = 8;
const WHEEL_GESTURE_RESET_MS = 160;
const TRANSITION_MS = 520;
const MIN_READER_FONT_SIZE = 8;
const WORD_START_DELAY_MS = 280;
const WORD_INTERVAL_MS = 285;
const WORD_END_HOLD_MS = 360;

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

function normalizeWheelDelta(event) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 18;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * window.innerHeight;
  }

  return event.deltaY;
}

function tokenizeSentence(sentence) {
  return sentence.match(/\s+|[^\s]+/g)?.map((token) => ({
    text: token,
    isWord: !/^\s+$/.test(token),
  })) || [];
}

function SentenceText({ sentence, className, fontSize, wordIndex, rhythmEnabled }) {
  if (!sentence) {
    return (
      <p className={`${className} sentence-break`} style={{ fontSize: `${fontSize}px` }}>
        {" "}
      </p>
    );
  }

  let wordCursor = -1;
  const isComplete = rhythmEnabled && wordIndex === -1;

  return (
    <p className={className} style={{ fontSize: `${fontSize}px` }}>
      {tokenizeSentence(sentence).map((token, tokenIndex) => {
        if (!token.isWord) {
          return token.text;
        }

        wordCursor += 1;

        const stateClass = rhythmEnabled
          ? isComplete
            ? "word-complete"
            : wordIndex === null
              ? "word-upcoming"
              : wordCursor < wordIndex
                ? "word-past"
                : wordCursor === wordIndex
                  ? "word-active"
                  : "word-upcoming"
          : "word-complete";

        return (
          <span className={`word ${stateClass}`} key={`${token.text}-${tokenIndex}`}>
            {token.text}
          </span>
        );
      })}
    </p>
  );
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
  const [activeWordIndex, setActiveWordIndex] = useState(null);
  const lastMoveAt = useRef(0);
  const touchStartY = useRef(null);
  const transitionTimer = useRef(null);
  const wordTimers = useRef([]);
  const wheelDelta = useRef(0);
  const wheelGestureConsumed = useRef(false);
  const wheelResetTimer = useRef(null);
  const isTransitioning = useRef(false);
  const lineStageRef = useRef(null);
  const measureRef = useRef(null);
  const [fitFontSize, setFitFontSize] = useState(fontSize);
  const [viewportTick, setViewportTick] = useState(0);
  const lines = useMemo(() => splitTextIntoSentences(text), [text]);
  const currentIndex = clamp(index, 0, Math.max(lines.length - 1, 0));
  const currentLine = lines[currentIndex] || "";
  const currentWordCount = useMemo(
    () => tokenizeSentence(currentLine).filter((token) => token.isWord).length,
    [currentLine],
  );
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
      wordTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    wordTimers.current.forEach((timer) => window.clearTimeout(timer));
    wordTimers.current = [];

    if (mode !== "read" || !currentLine || currentWordCount === 0) {
      setActiveWordIndex(-1);
      return;
    }

    setActiveWordIndex(null);

    const startTimer = window.setTimeout(() => {
      setActiveWordIndex(0);
    }, WORD_START_DELAY_MS);

    wordTimers.current.push(startTimer);

    for (let wordIndex = 1; wordIndex < currentWordCount; wordIndex += 1) {
      const timer = window.setTimeout(() => {
        setActiveWordIndex(wordIndex);
      }, WORD_START_DELAY_MS + wordIndex * WORD_INTERVAL_MS);

      wordTimers.current.push(timer);
    }

    const completeTimer = window.setTimeout(() => {
      setActiveWordIndex(-1);
    }, WORD_START_DELAY_MS + currentWordCount * WORD_INTERVAL_MS + WORD_END_HOLD_MS);

    wordTimers.current.push(completeTimer);

    return () => {
      wordTimers.current.forEach((timer) => window.clearTimeout(timer));
      wordTimers.current = [];
    };
  }, [animationId, currentLine, currentWordCount, mode]);

  useEffect(() => {
    function handleResize() {
      setViewportTick((value) => value + 1);
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  useLayoutEffect(() => {
    if (mode !== "read") {
      setFitFontSize(fontSize);
      return;
    }

    const stage = lineStageRef.current;
    const measure = measureRef.current;

    if (!stage || !measure) {
      return;
    }

    const stageStyle = window.getComputedStyle(stage);
    const availableWidth = Math.max(
      1,
      stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight),
    );
    const availableHeight = Math.max(
      1,
      stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom),
    );
    const measureWidth = Math.max(1, Math.min(availableWidth, 1080));
    const textsToFit = [currentLine, outgoingSentence].filter((sentence) => sentence);

    if (textsToFit.length === 0) {
      setFitFontSize(fontSize);
      return;
    }

    measure.style.width = `${measureWidth}px`;

    function fits(size) {
      measure.style.fontSize = `${size}px`;

      return textsToFit.every((sentence) => {
        measure.textContent = sentence;
        return measure.scrollWidth <= measureWidth + 1 && measure.scrollHeight <= availableHeight + 1;
      });
    }

    let low = MIN_READER_FONT_SIZE;
    let high = fontSize;

    if (fits(high)) {
      setFitFontSize(high);
      return;
    }

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);

      if (fits(mid)) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    setFitFontSize(low);
  }, [animationId, currentLine, fontSize, mode, outgoingSentence, viewportTick]);

  const move = useCallback(
    (step) => {
      if (mode !== "read" || lines.length === 0 || isTransitioning.current) {
        return false;
      }

      const now = Date.now();
      if (now - lastMoveAt.current < MOVE_LOCK_MS) {
        return false;
      }

      const nextIndex = clamp(currentIndex + step, 0, lines.length - 1);

      if (nextIndex === currentIndex) {
        return false;
      }

      window.clearTimeout(transitionTimer.current);
      lastMoveAt.current = now;
      isTransitioning.current = true;
      setOutgoingSentence(lines[currentIndex] || "");
      setDirection(step > 0 ? "next" : "prev");
      setAnimationId((id) => id + 1);
      setIndex(nextIndex);

      transitionTimer.current = window.setTimeout(() => {
        setOutgoingSentence(null);
        isTransitioning.current = false;
      }, TRANSITION_MS);

      return true;
    },
    [currentIndex, lines, mode],
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
      window.clearTimeout(wheelResetTimer.current);

      wheelResetTimer.current = window.setTimeout(() => {
        wheelDelta.current = 0;
        wheelGestureConsumed.current = false;
      }, WHEEL_GESTURE_RESET_MS);

      if (wheelGestureConsumed.current || isTransitioning.current) {
        return;
      }

      wheelDelta.current += normalizeWheelDelta(event);

      if (Math.abs(wheelDelta.current) >= WHEEL_THRESHOLD) {
        const step = wheelDelta.current > 0 ? 1 : -1;
        const didMove = move(step);

        if (didMove) {
          wheelDelta.current = 0;
          wheelGestureConsumed.current = true;
        }
      }
    }

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [mode, move]);

  function startReading() {
    if (!canRead) {
      return;
    }

    setDirection("idle");
    setOutgoingSentence(null);
    setActiveWordIndex(null);
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

        <section ref={lineStageRef} className="line-stage" aria-live="polite">
          {outgoingSentence !== null && (
            <SentenceText
              key={`out-${animationId}`}
              className={`sentence sentence-out ${direction} ${outgoingSentence ? "" : "sentence-break"}`}
              sentence={outgoingSentence}
              fontSize={fitFontSize}
              rhythmEnabled={false}
              wordIndex={-1}
            />
          )}
          <SentenceText
            key={`in-${animationId}`}
            className={`sentence sentence-in ${direction} ${currentLine ? "" : "sentence-break"}`}
            sentence={currentLine}
            fontSize={fitFontSize}
            rhythmEnabled
            wordIndex={activeWordIndex}
          />
          <p ref={measureRef} className="sentence-measure" aria-hidden="true" />
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
