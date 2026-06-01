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
const REVEAL_START_DELAY_MS = 280;
const WORD_INTERVAL_MS = 285;
const MIN_CHARACTER_INTERVAL_MS = 32;
const REVEAL_END_HOLD_MS = 360;
const HOLD_PAUSE_MS = 280;
const PRELOADED_TEXTS = [
  {
    id: "encyclical-on-ai",
    title: "Magnifica Humanitas",
    description: "An encyclical on safeguarding the human person in the time of artificial intelligence.",
    wordCount: 37352,
    image: new URL("../assets/LibraryImages/thumbs/encyclical-on-ai.jpg", import.meta.url).href,
    url: new URL("../assets/encyclical-on-ai.txt", import.meta.url).href,
  },
  {
    id: "medium-is-message",
    title: "The Medium is the Message",
    description: "Marshall McLuhan's essay on media, technology, and the scale of human affairs.",
    wordCount: 9116,
    image: new URL("../assets/LibraryImages/thumbs/medium-is-message.jpg", import.meta.url).href,
    url: new URL("../assets/medium-is-message.txt", import.meta.url).href,
  },
  {
    id: "work-of-art",
    title: "The Work of Art in the Age of Mechanical Reproduction",
    description: "Walter Benjamin on art, reproduction, aura, and the politics of media.",
    wordCount: 12686,
    image: new URL("../assets/LibraryImages/thumbs/work-of-art.jpg", import.meta.url).href,
    url: new URL("../assets/work-of-art.txt", import.meta.url).href,
  },
  {
    id: "do-artifacts-have-politics",
    title: "Do Artifacts Have Politics?",
    description: "Langdon Winner on technology, power, and political arrangements built into things.",
    wordCount: 8857,
    image: new URL("../assets/LibraryImages/thumbs/do-artifacts-have-politics.jpg", import.meta.url).href,
    url: new URL("../assets/do-artifacts-have-politics.txt", import.meta.url).href,
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

function SentenceText({ sentence, className, fontSize, characterIndex, rhythmEnabled }) {
  if (!sentence) {
    return (
      <p className={`${className} sentence-break`} style={{ fontSize: `${fontSize}px` }}>
        {" "}
      </p>
    );
  }

  let characterCursor = -1;
  const isComplete = rhythmEnabled && characterIndex === -1;

  return (
    <p className={className} style={{ fontSize: `${fontSize}px` }}>
      {Array.from(sentence).map((character, characterPosition) => {
        if (/\s/.test(character)) {
          return character;
        }

        characterCursor += 1;

        const stateClass = rhythmEnabled
          ? isComplete
            ? "character-complete"
            : characterIndex === null
              ? "character-upcoming"
              : characterCursor < characterIndex
                ? "character-past"
                : characterCursor === characterIndex
                  ? "character-active"
                  : "character-upcoming"
          : "character-complete";

        return (
          <span className={`character ${stateClass}`} key={`${character}-${characterPosition}`}>
            {character}
          </span>
        );
      })}
    </p>
  );
}

function App() {
  const savedState = useMemo(loadSavedState, []);
  const savedEditorText = savedState?.editorText ?? (savedState?.activePreloadedId ? DEFAULT_TEXT : savedState?.text);
  const [editorText, setEditorText] = useState(savedEditorText || DEFAULT_TEXT);
  const [readerText, setReaderText] = useState(savedState?.readerText || savedState?.text || savedEditorText || DEFAULT_TEXT);
  const [mode, setMode] = useState(savedState?.mode || "compose");
  const [index, setIndex] = useState(savedState?.index || 0);
  const [theme, setTheme] = useState(savedState?.theme || "light");
  const [direction, setDirection] = useState("idle");
  const [outgoingSentence, setOutgoingSentence] = useState(null);
  const [animationId, setAnimationId] = useState(0);
  const [activeCharacterIndex, setActiveCharacterIndex] = useState(null);
  const [loadingPreloadedId, setLoadingPreloadedId] = useState(null);
  const [activePreloadedId, setActivePreloadedId] = useState(savedState?.activePreloadedId || null);
  const [preloadedProgress, setPreloadedProgress] = useState(savedState?.preloadedProgress || {});
  const activeCharacterIndexRef = useRef(null);
  const lastMoveAt = useRef(0);
  const touchStartY = useRef(null);
  const touchStartAt = useRef(0);
  const pressStartAt = useRef(0);
  const suppressTouchNavigation = useRef(false);
  const suppressNextTapClick = useRef(false);
  const transitionTimer = useRef(null);
  const holdPauseTimer = useRef(null);
  const tapSuppressTimer = useRef(null);
  const revealTimers = useRef([]);
  const isRhythmPaused = useRef(false);
  const wheelDelta = useRef(0);
  const wheelGestureConsumed = useRef(false);
  const wheelResetTimer = useRef(null);
  const isTransitioning = useRef(false);
  const lineStageRef = useRef(null);
  const measureRef = useRef(null);
  const [fitFontSize, setFitFontSize] = useState(READER_FONT_SIZE);
  const [viewportTick, setViewportTick] = useState(0);
  const lines = useMemo(() => splitTextIntoSentences(readerText), [readerText]);
  const editorLines = useMemo(() => splitTextIntoSentences(editorText), [editorText]);
  const scrollDurationLabel = useMemo(() => formatScrollDuration(countWords(editorText)), [editorText]);
  const currentIndex = clamp(index, 0, Math.max(lines.length - 1, 0));
  const currentLine = lines[currentIndex] || "";
  const currentWordCount = useMemo(
    () => tokenizeSentence(currentLine).filter((token) => token.isWord).length,
    [currentLine],
  );
  const currentCharacterCount = useMemo(
    () => Array.from(currentLine).filter((character) => !/\s/.test(character)).length,
    [currentLine],
  );
  const canRead = editorLines.length > 0;

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        editorText,
        readerText,
        text: editorText,
        mode,
        index: currentIndex,
        theme,
        activePreloadedId,
        preloadedProgress,
      }),
    );
  }, [editorText, readerText, mode, currentIndex, theme, activePreloadedId, preloadedProgress]);

  useEffect(() => {
    if (!activePreloadedId) {
      return;
    }

    setPreloadedProgress((progress) => {
      if (progress[activePreloadedId] === currentIndex) {
        return progress;
      }

      return {
        ...progress,
        [activePreloadedId]: currentIndex,
      };
    });
  }, [activePreloadedId, currentIndex]);

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
      window.clearTimeout(holdPauseTimer.current);
      window.clearTimeout(tapSuppressTimer.current);
      revealTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    activeCharacterIndexRef.current = activeCharacterIndex;
  }, [activeCharacterIndex]);

  const clearRevealTimers = useCallback(() => {
    revealTimers.current.forEach((timer) => window.clearTimeout(timer));
    revealTimers.current = [];
  }, []);

  const scheduleCharacterRhythm = useCallback(
    (startCharacterIndex, firstDelay) => {
      clearRevealTimers();

      if (mode !== "read" || !currentLine || currentCharacterCount === 0) {
        setActiveCharacterIndex(-1);
        return;
      }

      if (isRhythmPaused.current) {
        return;
      }

      if (startCharacterIndex >= currentCharacterCount) {
        const completeTimer = window.setTimeout(() => {
          setActiveCharacterIndex(-1);
        }, REVEAL_END_HOLD_MS);

        revealTimers.current.push(completeTimer);
        return;
      }

      const characterInterval = Math.max(
        MIN_CHARACTER_INTERVAL_MS,
        (Math.max(currentWordCount, 1) * WORD_INTERVAL_MS) / currentCharacterCount,
      );

      for (let characterIndex = startCharacterIndex; characterIndex < currentCharacterCount; characterIndex += 1) {
        const delay = firstDelay + (characterIndex - startCharacterIndex) * characterInterval;
        const timer = window.setTimeout(() => {
          setActiveCharacterIndex(characterIndex);
        }, delay);

        revealTimers.current.push(timer);
      }

      const completeTimer = window.setTimeout(() => {
        setActiveCharacterIndex(-1);
      }, firstDelay + (currentCharacterCount - startCharacterIndex) * characterInterval + REVEAL_END_HOLD_MS);

      revealTimers.current.push(completeTimer);
    },
    [clearRevealTimers, currentCharacterCount, currentLine, currentWordCount, mode],
  );

  useEffect(() => {
    clearRevealTimers();

    if (mode !== "read" || !currentLine || currentCharacterCount === 0) {
      setActiveCharacterIndex(-1);
      return;
    }

    setActiveCharacterIndex(null);
    scheduleCharacterRhythm(0, REVEAL_START_DELAY_MS);

    return () => {
      clearRevealTimers();
    };
  }, [animationId, clearRevealTimers, currentCharacterCount, currentLine, mode, scheduleCharacterRhythm]);

  useEffect(() => {
    function handleResize() {
      setViewportTick((value) => value + 1);
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("scroll", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("scroll", handleResize);
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

    setReaderText(editorText);
    setActivePreloadedId(null);
    setIndex(0);
    setDirection("idle");
    setOutgoingSentence(null);
    setActiveCharacterIndex(null);
    isTransitioning.current = false;
    setMode("read");
  }

  function clearText() {
    setEditorText("");
    setDirection("idle");
    setOutgoingSentence(null);
    setActiveCharacterIndex(null);
    clearRevealTimers();
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
      const savedIndex = preloadedProgress[preloadedText.id] || 0;
      setReaderText(loadedText);
      setIndex(savedIndex);
      setActivePreloadedId(preloadedText.id);
      setDirection("idle");
      setOutgoingSentence(null);
      setActiveCharacterIndex(null);
      clearRevealTimers();
      isTransitioning.current = false;
      setMode("read");
    } finally {
      setLoadingPreloadedId(null);
    }
  }

  function openOverview() {
    clearRevealTimers();
    setOutgoingSentence(null);
    setDirection("idle");
    setActiveCharacterIndex(null);
    isTransitioning.current = false;
    setMode("overview");
  }

  function startFromSentence(sentenceIndex) {
    clearRevealTimers();
    setIndex(sentenceIndex);
    setOutgoingSentence(null);
    setDirection("idle");
    setActiveCharacterIndex(null);
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
    window.clearTimeout(holdPauseTimer.current);
    holdPauseTimer.current = window.setTimeout(() => {
      suppressTouchNavigation.current = true;
      suppressNextTapClick.current = true;
    }, HOLD_PAUSE_MS);
    clearRevealTimers();
  }

  function resumeWordRhythm() {
    if (mode !== "read" || !isRhythmPaused.current) {
      return;
    }

    window.clearTimeout(holdPauseTimer.current);

    if (Date.now() - pressStartAt.current >= HOLD_PAUSE_MS) {
      suppressTouchNavigation.current = true;
      suppressNextTapClick.current = true;
      window.clearTimeout(tapSuppressTimer.current);
      tapSuppressTimer.current = window.setTimeout(() => {
        suppressNextTapClick.current = false;
      }, 450);
    }

    pressStartAt.current = 0;
    isRhythmPaused.current = false;

    if (!currentLine || currentCharacterCount === 0 || activeCharacterIndexRef.current === -1) {
      return;
    }

    const characterInterval = Math.max(
      MIN_CHARACTER_INTERVAL_MS,
      (Math.max(currentWordCount, 1) * WORD_INTERVAL_MS) / currentCharacterCount,
    );
    const nextCharacterIndex = activeCharacterIndexRef.current === null ? 0 : activeCharacterIndexRef.current + 1;
    scheduleCharacterRhythm(nextCharacterIndex, activeCharacterIndexRef.current === null ? 120 : characterInterval);
  }

  function handleTapNavigation(step, event) {
    if (suppressNextTapClick.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextTapClick.current = false;
      return;
    }

    move(step);
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
              characterIndex={-1}
            />
          )}
          <SentenceText
            key={`in-${animationId}`}
            className={`sentence sentence-in ${direction} ${currentLine ? "" : "sentence-break"}`}
            sentence={currentLine}
            fontSize={fitFontSize}
            rhythmEnabled
            characterIndex={activeCharacterIndex}
          />
          <p ref={measureRef} className="sentence-measure" aria-hidden="true" />
        </section>

        <div className="reader-footer">
          <span>{currentIndex + 1} / {lines.length}</span>
          <span>{currentLine ? `${currentLine.length} chars` : "paragraph break"}</span>
        </div>

        <button className="tap-zone tap-prev" type="button" onClick={(event) => handleTapNavigation(-1, event)} aria-label="Previous line" />
        <button className="tap-zone tap-next" type="button" onClick={(event) => handleTapNavigation(1, event)} aria-label="Next line" />
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
            Take a scroll
          </h1>
        </div>

        <textarea
          id="source-text"
          aria-label="Text to read"
          value={editorText}
          onChange={(event) => {
            setEditorText(event.target.value);
          }}
          placeholder="Paste your text here, then scroll through it one line at a time."
        />

        <div className="action-row">
          {editorText.trim() && <p>{scrollDurationLabel}</p>}
          <div className="compose-actions">
            <button className="secondary-button" type="button" onClick={clearText} disabled={!editorText}>
              Clear
            </button>
            <button className="primary-button" type="button" onClick={startReading} disabled={!canRead}>
              Read
            </button>
          </div>
        </div>

        <section className="preloaded-section" aria-label="Preloaded texts">
          <h2>Library</h2>
          {PRELOADED_TEXTS.map((preloadedText) => (
            <button
              className="preloaded-item"
              type="button"
              key={preloadedText.id}
              onClick={() => readPreloadedText(preloadedText)}
              disabled={loadingPreloadedId !== null}
            >
              <img src={preloadedText.image} alt="" loading="lazy" aria-hidden="true" />
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
