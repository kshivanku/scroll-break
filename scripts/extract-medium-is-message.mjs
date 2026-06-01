import { readFile, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const inputPath = "assets/MediumIsMessage.pdf";
const outputPath = "assets/medium-is-message.txt";

function decodePdfString(raw) {
  let out = "";

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (character !== "\\") {
      out += character;
      continue;
    }

    const next = raw[++index];

    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (/[0-7]/.test(next || "")) {
      let octal = next;

      for (let offset = 0; offset < 2 && /[0-7]/.test(raw[index + 1] || ""); offset += 1) {
        octal += raw[++index];
      }

      out += String.fromCharCode(parseInt(octal, 8));
    } else if (next === "\n" || next === "\r") {
      if (next === "\r" && raw[index + 1] === "\n") index += 1;
    } else {
      out += next || "";
    }
  }

  return out
    .replace(/É/g, "...")
    .replace(/Ñ/g, "--")
    .replace(/[ÔÕ]/g, "'")
    .replace(/[ÒÓ]/g, "\"")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");
}

function extractTextItems(content) {
  const items = [];
  const blockRegex = /([\d.-]+)\s+0\s+0\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+cm\s+BT([\s\S]*?)ET/g;
  let block;

  while ((block = blockRegex.exec(content))) {
    const scaleX = parseFloat(block[1]);
    const scaleY = parseFloat(block[2]);
    const baseX = parseFloat(block[3]);
    const baseY = parseFloat(block[4]);
    const body = block[5];
    const textRegex = /([\d.-]+)\s+0\s+0\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+Tm[\s\S]*?\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let text;

    while ((text = textRegex.exec(body))) {
      const fontSize = parseFloat(text[1]) * Math.abs(scaleY);
      const x = baseX + parseFloat(text[3]) * scaleX;
      const y = baseY + parseFloat(text[4]) * scaleY;
      const value = decodePdfString(text[5]);

      if (value) {
        items.push({ fontSize, value, x, y });
      }
    }
  }

  return items;
}

function groupIntoLines(items) {
  const lines = [];

  for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) < 1.8);

    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }

    line.items.push(item);
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => ({
      text: line.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.value)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
      x: Math.min(...line.items.map((item) => item.x)),
      y: line.y,
    }))
    .filter((line) => line.text)
    .filter((line) => !/^\d+$/.test(line.text));
}

function extractPositionedText(pdf) {
  const bytes = pdf.toString("latin1");
  const streamRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)stream\r?\n/g;
  const pages = [];
  let match;

  while ((match = streamRegex.exec(bytes))) {
    const [, , , streamHead] = match;

    if (!/FlateDecode/.test(streamHead)) {
      continue;
    }

    const start = match.index + match[0].length;
    const end = bytes.indexOf("endstream", start);

    if (end < 0) {
      continue;
    }

    let rawEnd = end;
    if (pdf[rawEnd - 1] === 10) rawEnd -= 1;
    if (pdf[rawEnd - 1] === 13) rawEnd -= 1;

    let content;
    try {
      content = inflateSync(pdf.subarray(start, rawEnd)).toString("latin1");
    } catch {
      continue;
    }

    if (!/\bBT\b/.test(content) || !/\bTj\b/.test(content)) {
      continue;
    }

    const lines = groupIntoLines(extractTextItems(content));

    if (lines.length > 0) {
      pages.push(lines);
    }
  }

  return pages;
}

function normalizeBody(lines) {
  const paragraphs = [];
  let current = "";
  let previousLine = null;

  function flush() {
    const paragraph = current
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s+/g, " ")
      .trim();

    if (paragraph) {
      paragraphs.push(paragraph);
    }

    current = "";
  }

  for (const line of lines) {
    const text = line.text.trim();

    if (!text || /^From$/.test(text) || /^CHAPTER 1$/.test(text)) {
      previousLine = line;
      continue;
    }

    const isHeading = [
      "Understanding Media:",
      "The Extensions of Man",
      "The Medium is the Message",
      "MARSHALL McLUHAN",
    ].includes(text);
    const hasLargeGap = previousLine && Math.abs(previousLine.y - line.y) > 18;
    const isIndented = line.x > 135;

    if (isHeading) {
      flush();
      paragraphs.push(text);
      previousLine = line;
      continue;
    }

    if (hasLargeGap || (isIndented && current && /[.!?:]"?$/.test(current))) {
      flush();
    }

    if (!current) {
      current = text;
    } else if (current.endsWith("-")) {
      current = `${current.slice(0, -1)}${text}`;
    } else {
      current = `${current} ${text}`;
    }

    previousLine = line;
  }

  flush();

  return paragraphs
    .join("\n\n")
    .replace(/-\n\n(?=[a-z])/g, "")
    .replace(/©/g, "(c)")
    .replace(//g, "e")
    .replace(//g, "c")
    .replace(/\bMcCLUHAN\b/g, "McLuhan")
    .replace(/\bMARSHALL McLuhan\b/g, "Marshall McLuhan")
    .replace(/\bco11eague\b/g, "colleague")
    .replace(/\bspecilized\b/g, "specialized")
    .replace(/\bone-bitat-a-time\b/g, "one-bit-at-a-time")
    .trim();
}

const pages = extractPositionedText(await readFile(inputPath));
const allLines = pages.flat();
const cleanedText = `${normalizeBody(allLines)}\n`;

await writeFile(outputPath, cleanedText, "utf8");

console.log(JSON.stringify({
  outputPath,
  pages: pages.length,
  paragraphs: cleanedText.split(/\n{2,}/).filter(Boolean).length,
  words: cleanedText.split(/\s+/).filter(Boolean).length,
  characters: cleanedText.length,
}, null, 2));
