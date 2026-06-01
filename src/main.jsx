import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const STORAGE_KEY = "scroll-break-state";
const DEFAULT_TEXT = "";
const MOVE_LOCK_MS = 540;
const WHEEL_THRESHOLD = 8;
const WHEEL_GESTURE_RESET_MS = 160;
const TRANSITION_MS = 520;
const MIN_READER_FONT_SIZE = 8;
const READER_FONT_SIZE = 38;
const WORD_START_DELAY_MS = 280;
const WORD_INTERVAL_MS = 285;
const WORD_END_HOLD_MS = 360;
const HOLD_PAUSE_MS = 280;
const PRELOADED_TEXTS = [
  {
    id: "encyclical-on-ai",
    title: "Magnifica Humanitas",
    description: "An encyclical on safeguarding the human person in the time of artificial intelligence.",
    wordCount: 37352,
    url: new URL("../assets/encyclical-on-ai.txt", import.meta.url).href,
  },
];

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

function findReadableIndex(lines, startIndex, step) {
  let nextIndex = clamp(startIndex + step, 0, Math.max(lines.length - 1, 0));

  while (nextIndex >= 0 && nextIndex < lines.length && !lines[nextIndex]) {
    nextIndex += step;
  }

  if (nextIndex < 0 || nextIndex >= lines.length) {
    return startIndex;
  }

  return nextIndex;
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

function countWords(text) {
  return text.match(/\S+/g)?.length || 0;
}

function formatScrollDuration(wordCount) {
  const minutes = Math.round((wordCount * WORD_INTERVAL_MS) / 60000);

  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} of scrolling`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} of scrolling`;
  }

  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} min of scrolling`;
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
  const [theme, setTheme] = useState(savedState?.theme || "light");
  const [direction, setDirection] = useState("idle");
  const [outgoingSentence, setOutgoingSentence] = useState(null);
  const [animationId, setAnimationId] = useState(0);
  const [activeWordIndex, setActiveWordIndex] = useState(null);
  const [loadingPreloadedId, setLoadingPreloadedId] = useState(null);
  const activeWordIndexRef = useRef(null);
  const lastMoveAt = useRef(0);
  const touchStartY = useRef(null);
  const touchStartAt = useRef(0);
  const pressStartAt = useRef(0);
  const suppressTouchNavigation = useRef(false);
  const transitionTimer = useRef(null);
  const wordTimers = useRef([]);
  const isRhythmPaused = useRef(false);
  const wheelDelta = useRef(0);
  const wheelGestureConsumed = useRef(false);
  const wheelResetTimer = useRef(null);
  const isTransitioning = useRef(false);
  const lineStageRef = useRef(null);
  const measureRef = useRef(null);
  const [fitFontSize, setFitFontSize] = useState(READER_FONT_SIZE);
  const [viewportTick, setViewportTick] = useState(0);
  const lines = useMemo(() => splitTextIntoSentences(text), [text]);
  const scrollDurationLabel = useMemo(() => formatScrollDuration(countWords(text)), [text]);
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
      JSON.stringify({ text, mode, index: currentIndex, theme }),
    );
  }, [text, mode, currentIndex, theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (currentIndex !== index) {
      setIndex(currentIndex);
    }
  }, [currentIndex, index]);

  useEffect(() => {
    if (mode !== "read" || !lines.length || currentLine) {
      return;
    }

    const nextReadableIndex = findReadableIndex(lines, currentIndex, 1);
    const fallbackReadableIndex = findReadableIndex(lines, currentIndex, -1);
    const readableIndex = nextReadableIndex !== currentIndex ? nextReadableIndex : fallbackReadableIndex;

    if (readableIndex !== currentIndex) {
      setIndex(readableIndex);
    }
  }, [currentIndex, currentLine, lines, mode]);

  useEffect(() => {
    if (mode !== "overview") {
      return;
    }

    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-overview-index="${currentIndex}"]`)
        ?.scrollIntoView({ block: "center" });
    });
  }, [currentIndex, mode]);

  useEffect(() => {
    return () => {
      window.clearTimeout(transitionTimer.current);
      window.clearTimeout(wheelResetTimer.current);
      wordTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    activeWordIndexRef.current = activeWordIndex;
  }, [activeWordIndex]);

  const clearWordTimers = useCallback(() => {
    wordTimers.current.forEach((timer) => window.clearTimeout(timer));
    wordTimers.current = [];
  }, []);

  const scheduleWordRhythm = useCallback(
    (startWordIndex, firstDelay) => {
      clearWordTimers();

      if (mode !== "read" || !currentLine || currentWordCount === 0) {
        setActiveWordIndex(-1);
        return;
      }

      if (isRhythmPaused.current) {
        return;
      }

      if (startWordIndex >= currentWordCount) {
        const completeTimer = window.setTimeout(() => {
          setActiveWordIndex(-1);
        }, WORD_END_HOLD_MS);

        wordTimers.current.push(completeTimer);
        return;
      }

      for (let wordIndex = startWordIndex; wordIndex < currentWordCount; wordIndex += 1) {
        const delay = firstDelay + (wordIndex - startWordIndex) * WORD_INTERVAL_MS;
        const timer = window.setTimeout(() => {
          setActiveWordIndex(wordIndex);
        }, delay);

        wordTimers.current.push(timer);
      }

      const completeTimer = window.setTimeout(() => {
        setActiveWordIndex(-1);
      }, firstDelay + (currentWordCount - startWordIndex) * WORD_INTERVAL_MS + WORD_END_HOLD_MS);

      wordTimers.current.push(completeTimer);
    },
    [clearWordTimers, currentLine, currentWordCount, mode],
  );

  useEffect(() => {
    clearWordTimers();

    if (mode !== "read" || !currentLine || currentWordCount === 0) {
      setActiveWordIndex(-1);
      return;
    }

    setActiveWordIndex(null);
    scheduleWordRhythm(0, WORD_START_DELAY_MS);

    return () => {
      clearWordTimers();
    };
  }, [animationId, clearWordTimers, currentLine, currentWordCount, mode, scheduleWordRhythm]);

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
      setFitFontSize(READER_FONT_SIZE);
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
      setFitFontSize(READER_FONT_SIZE);
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
    let high = READER_FONT_SIZE;

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
  }, [animationId, currentLine, mode, outgoingSentence, viewportTick]);

  const move = useCallback(
    (step) => {
      if (mode !== "read" || lines.length === 0 || isTransitioning.current) {
        return false;
      }

      const now = Date.now();
      if (now - lastMoveAt.current < MOVE_LOCK_MS) {
        return false;
      }

      const nextIndex = findReadableIndex(lines, currentIndex, step);

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

  function clearText() {
    setText("");
    setIndex(0);
    setDirection("idle");
    setOutgoingSentence(null);
    setActiveWordIndex(null);
    clearWordTimers();
  }

  async function readPreloadedText(preloadedText) {
    if (loadingPreloadedId) {
      return;
    }

    setLoadingPreloadedId(preloadedText.id);

    try {
      const response = await fetch(preloadedText.url);

      if (!response.ok) {
        throw new Error(`Unable to load ${preloadedText.title}`);
      }

      const loadedText = await response.text();
      setText(loadedText);
      setIndex(0);
      setDirection("idle");
      setOutgoingSentence(null);
      setActiveWordIndex(null);
      clearWordTimers();
      isTransitioning.current = false;
      setMode("read");
    } finally {
      setLoadingPreloadedId(null);
    }
  }

  function openOverview() {
    clearWordTimers();
    setOutgoingSentence(null);
    setDirection("idle");
    setActiveWordIndex(null);
    isTransitioning.current = false;
    setMode("overview");
  }

  function startFromSentence(sentenceIndex) {
    clearWordTimers();
    setIndex(sentenceIndex);
    setOutgoingSentence(null);
    setDirection("idle");
    setActiveWordIndex(null);
    isTransitioning.current = false;
    setMode("read");
  }

  function handleTouchStart(event) {
    touchStartY.current = event.touches[0]?.clientY ?? null;
    touchStartAt.current = Date.now();
  }

  function handleTouchEnd(event) {
    if (touchStartY.current === null) {
      return;
    }

    const endY = event.changedTouches[0]?.clientY ?? touchStartY.current;
    const distance = touchStartY.current - endY;
    const touchDuration = Date.now() - touchStartAt.current;
    touchStartY.current = null;
    touchStartAt.current = 0;

    if (suppressTouchNavigation.current || touchDuration >= HOLD_PAUSE_MS) {
      suppressTouchNavigation.current = false;
      return;
    }

    if (Math.abs(distance) > 48) {
      move(distance > 0 ? 1 : -1);
    }
  }

  function pauseWordRhythm() {
    if (mode !== "read" || isRhythmPaused.current) {
      return;
    }

    isRhythmPaused.current = true;
    pressStartAt.current = Date.now();
    clearWordTimers();
  }

  function resumeWordRhythm() {
    if (mode !== "read" || !isRhythmPaused.current) {
      return;
    }

    if (Date.now() - pressStartAt.current >= HOLD_PAUSE_MS) {
      suppressTouchNavigation.current = true;
    }

    pressStartAt.current = 0;
    isRhythmPaused.current = false;

    if (!currentLine || currentWordCount === 0 || activeWordIndexRef.current === -1) {
      return;
    }

    const nextWordIndex = activeWordIndexRef.current === null ? 0 : activeWordIndexRef.current + 1;
    scheduleWordRhythm(nextWordIndex, activeWordIndexRef.current === null ? 120 : WORD_INTERVAL_MS);
  }

  const themeToggle = (
    <button
      className="theme-toggle"
      type="button"
      onClick={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Dark mode" : "Light mode"}
    >
      <span aria-hidden="true">{theme === "light" ? "☾" : "☼"}</span>
    </button>
  );

  if (mode === "read") {
    const progress = lines.length ? ((currentIndex + 1) / lines.length) * 100 : 0;

    return (
      <main
        className="reader"
        onPointerDown={pauseWordRhythm}
        onPointerUp={resumeWordRhythm}
        onPointerCancel={resumeWordRhythm}
        onPointerLeave={resumeWordRhythm}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        aria-label="Reader"
      >
        {themeToggle}
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
          <button className="icon-button" type="button" onClick={openOverview} aria-label="Open text overview">
            <span aria-hidden="true">☷</span>
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

  if (mode === "overview") {
    return (
      <main className="overview" aria-label="Text overview">
        {themeToggle}
        <div className="reader-actions" aria-label="Overview controls">
          <button className="icon-button" type="button" onClick={() => setMode("read")} aria-label="Back to reader">
            <span aria-hidden="true">←</span>
          </button>
          <button className="icon-button" type="button" onClick={() => setMode("compose")} aria-label="Back to editor">
            <span aria-hidden="true">✎</span>
          </button>
        </div>

        <section className="overview-list">
          {lines.map((line, sentenceIndex) =>
            line ? (
              <button
                className={`overview-sentence ${sentenceIndex === currentIndex ? "active" : ""}`}
                data-overview-index={sentenceIndex}
                key={`${line}-${sentenceIndex}`}
                type="button"
                onClick={() => startFromSentence(sentenceIndex)}
              >
                {line}
              </button>
            ) : (
              <div
                className="overview-break"
                data-overview-index={sentenceIndex}
                key={`break-${sentenceIndex}`}
                aria-hidden="true"
              />
            ),
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="compose">
      {themeToggle}
      <section className="compose-panel">
        <div className="compose-copy">
          <h1>
            Take a scroll break
          </h1>
        </div>

        <textarea
          id="source-text"
          aria-label="Text to read"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste your text here, then scroll through it one line at a time."
        />

        <div className="action-row">
          {text.trim() && <p>{scrollDurationLabel}</p>}
          <div className="compose-actions">
            <button className="secondary-button" type="button" onClick={clearText} disabled={!text}>
              Clear
            </button>
            <button className="primary-button" type="button" onClick={startReading} disabled={!canRead}>
              Read
            </button>
          </div>
        </div>

        <section className="preloaded-section" aria-label="Preloaded texts">
          <h2>Articles</h2>
          {PRELOADED_TEXTS.map((preloadedText) => (
            <button
              className="preloaded-item"
              type="button"
              key={preloadedText.id}
              onClick={() => readPreloadedText(preloadedText)}
              disabled={loadingPreloadedId !== null}
            >
              <span>{preloadedText.title}</span>
              <em>{formatScrollDuration(preloadedText.wordCount)}</em>
              <small>
                {loadingPreloadedId === preloadedText.id ? "Loading..." : preloadedText.description}
              </small>
            </button>
          ))}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
