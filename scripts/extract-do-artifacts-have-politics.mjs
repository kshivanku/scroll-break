import { readFile, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const inputPath = "assets/DoArtifactsHavePolitics.pdf";
const outputPath = "assets/do-artifacts-have-politics.txt";

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

function extractChunksFromContent(content) {
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

function extractPdfChunks(pdf) {
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
      chunks.push(...extractChunksFromContent(inflateSync(pdf.subarray(start, rawEnd))));
    } catch {
      // Ignore image/font streams.
    }
  }

  return chunks;
}

function normalizeToken(token) {
  return token
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fixCommonWraps(text) {
  return text
    .replace(/\bpro vocative\b/g, "provocative")
    .replace(/\bpro ductivity\b/g, "productivity")
    .replace(/\bfundamen tally\b/g, "fundamentally")
    .replace(/\bappropri ate\b/g, "appropriate")
    .replace(/\baggre gates\b/g, "aggregates")
    .replace(/\bin stance\b/g, "instance")
    .replace(/\bimpor tance\b/g, "importance")
    .replace(/\bex amples\b/g, "examples")
    .replace(/\bpur poses\b/g, "purposes")
    .replace(/\befficien cy\b/g, "efficiency")
    .replace(/\bMold ers\b/g, "Molders")
    .replace(/\bac tually\b/g, "actually")
    .replace(/\bade quately\b/g, "adequately")
    .replace(/\bfasci nating\b/g, "fascinating")
    .replace(/\bphos phate\b/g, "phosphate")
    .replace(/\bindustrial ism\b/g, "industrialism")
    .replace(/\bhis tory\b/g, "history")
    .replace(/\bneo lithic\b/g, "neolithic")
    .replace(/\bauton omy\b/g, "autonomy")
    .replace(/\btech nology\b/g, "technology")
    .replace(/\btech nologies\b/g, "technologies")
    .replace(/\bsys tems\b/g, "systems")
    .replace(/\bcom munity\b/g, "community")
    .replace(/\bcommu nity\b/g, "community")
    .replace(/\bcon trol\b/g, "control")
    .replace(/\bcon trolled\b/g, "controlled")
    .replace(/\bcon trols\b/g, "controls")
    .replace(/\bcon cern\b/g, "concern")
    .replace(/\bcon cerns\b/g, "concerns")
    .replace(/\bpub lic\b/g, "public")
    .replace(/\bpol itics\b/g, "politics")
    .replace(/\bpo litical\b/g, "political")
    .replace(/\bpolit ical\b/g, "political")
    .replace(/\btech nics\b/g, "technics")
    .replace(/\bma chines\b/g, "machines")
    .replace(/\bman centered\b/g, "man-centered")
    .replace(/\bsystem centered\b/g, "system-centered")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(chunks) {
  const tokens = chunks
    .map(normalizeToken)
    .filter(Boolean)
    .filter((token) => !/^https?:\/\//i.test(token))
    .filter((token) => token !== "Daedalus.");

  const startIndex = tokens.findIndex((token, index) =>
    token === "LANGDON" && tokens[index + 1] === "WINNER",
  );
  const bodyTokens = tokens.slice(startIndex >= 0 ? startIndex : 0);
  const paragraphs = [];
  let current = "";

  function flush() {
    const paragraph = fixCommonWraps(current);
    if (paragraph) paragraphs.push(paragraph);
    current = "";
  }

  for (let index = 0; index < bodyTokens.length; index += 1) {
    const token = bodyTokens[index];
    const next = bodyTokens[index + 1];
    const nextTwo = bodyTokens[index + 2];

    if (/^(The MIT Press|American Academy|JSTOR|Please contact|Each copy|Your use of)/i.test(token)) {
      continue;
    }

    if (token === "LANGDON" && next === "WINNER") {
      flush();
      paragraphs.push("Langdon Winner");
      index += 1;
      continue;
    }

    if (token === "Do" && next === "Artifacts" && nextTwo === "Have") {
      flush();
      paragraphs.push("Do Artifacts Have Politics?");
      index += 3;
      continue;
    }

    if (/^\d+[A-Z]/.test(token) || /^2sIbid/.test(token) || /^26Ibid/.test(token) || /^27Leonard/.test(token)) {
      flush();
      continue;
    }

    if (!current) {
      current = token;
    } else {
      current += ` ${token}`;
    }

    if (/[.!?]"?$/.test(token) && next && /^[A-Z]/.test(next) && current.split(/\s+/).length > 45) {
      flush();
    }
  }

  flush();

  return `${paragraphs
    .filter((paragraph, index) => paragraph !== paragraphs[index - 1])
    .join("\n\n")
    .replace(/\b\d{3}\s+\d{3}\s+Langdon Winner\s+/g, "")
    .replace(/\s+DO ARTIFACTS HAVE POLITICS\?\s+\d+\s+/g, " ")
    .replace(/\s+Langdon Winner\s+/g, " ")
    .replace(/\s+\d{3}\s+/g, " ")
    .replace(/\bphos phate\b/g, "phosphate")
    .replace(/\bcom puter\b/g, "computer")
    .replace(/\bscien tists\b/g, "scientists")
    .replace(/\bac counting\b/g, "accounting")
    .replace(/\btech nological\b/g, "technological")
    .replace(/\binven tion\b/g, "invention")
    .replace(/\barrange ments\b/g, "arrangements")
    .replace(/\brela tionships\b/g, "relationships")
    .replace(/\bhigh ways\b/g, "highways")
    .replace(/\bvan ee\b/g, "vance")
    .replace(/\bsto len\b/g, "stolen")
    .replace(/\bre liable\b/g, "reliable")
    .replace(/\bdiffi culties\b/g, "difficulties")
    .replace(/\bHarvest er\b/g, "Harvester")
    .replace(/\bofthat\b/g, "of that")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

const cleanedText = cleanText(extractPdfChunks(await readFile(inputPath)));
await writeFile(outputPath, cleanedText, "utf8");

console.log(JSON.stringify({
  outputPath,
  paragraphs: cleanedText.split(/\n{2,}/).filter(Boolean).length,
  words: cleanedText.split(/\s+/).filter(Boolean).length,
  characters: cleanedText.length,
}, null, 2));
