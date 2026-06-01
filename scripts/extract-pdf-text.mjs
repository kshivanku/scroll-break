import { readFile, writeFile } from "node:fs/promises";
import { inflate } from "node:zlib";
import { promisify } from "node:util";

const inflateAsync = promisify(inflate);

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

  return out;
}

function extractStringsFromContent(content) {
  const text = content.toString("latin1");
  const chunks = [];
  const textRegex = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  const textArrayRegex = /\[((?:.|\n|\r)*?)\]\s*TJ/g;
  let match;

  while ((match = textRegex.exec(text))) {
    chunks.push(decodePdfString(match[1]));
  }

  while ((match = textArrayRegex.exec(text))) {
    const itemRegex = /\(((?:\\.|[^\\)])*)\)/g;
    let item;
    let line = "";

    while ((item = itemRegex.exec(match[1]))) {
      line += decodePdfString(item[1]);
    }

    if (line) chunks.push(line);
  }

  return chunks;
}

async function extractPdfText(path) {
  const pdf = await readFile(path);
  const bytes = pdf.toString("latin1");
  const streamRegex = /<<(?:.|\n|\r)*?\/Filter\s*\/FlateDecode(?:.|\n|\r)*?>>\s*stream\r?\n/g;
  const chunks = [];
  let match;

  while ((match = streamRegex.exec(bytes))) {
    const start = match.index + match[0].length;
    const end = bytes.indexOf("endstream", start);

    if (end === -1) continue;

    let rawEnd = end;
    if (pdf[rawEnd - 1] === 10) rawEnd -= 1;
    if (pdf[rawEnd - 1] === 13) rawEnd -= 1;

    try {
      const inflated = await inflateAsync(pdf.subarray(start, rawEnd));
      chunks.push(...extractStringsFromContent(inflated));
    } catch {
      // Some compressed streams are fonts or images, not text content.
    }
  }

  return chunks;
}

function cleanText(chunks) {
  const lines = chunks
    .map((chunk) => chunk.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((chunk) => /[A-Za-z]{2}/.test(chunk))
    .filter((line) => !/^Page \d+ of \d+$/i.test(line))
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => line !== "Multimedia");
  const compacted = [];

  for (const line of lines) {
    if (line !== compacted[compacted.length - 1]) {
      compacted.push(line);
    }
  }

  return `${compacted
    .join("\n")
    .replace(/Õ/g, "'")
    .replace(/[ÒÓ]/g, "\"")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/extract-pdf-text.mjs input.pdf output.txt");
  process.exit(1);
}

const text = cleanText(await extractPdfText(inputPath));
await writeFile(outputPath, text, "utf8");

console.log(JSON.stringify({
  outputPath,
  characters: text.length,
  words: text.split(/\s+/).filter(Boolean).length,
}, null, 2));
