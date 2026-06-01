import { readFile, writeFile } from "node:fs/promises";

const inputPath = "assets/encyclical-on-ai.txt";
const rawLines = (await readFile(inputPath, "utf8")).split(/\r?\n/);
const introductionIndexes = rawLines
  .map((line, index) => (line.trim() === "INTRODUCTION" ? index : -1))
  .filter((index) => index >= 0);
const startIndex = introductionIndexes[1] ?? introductionIndexes[0] ?? 0;
const signatureIndex = rawLines.findIndex((line) => line.trim() === "LEO PP. XIV");
const endIndex = signatureIndex >= 0 ? signatureIndex : rawLines.findIndex((line) => line.startsWith("Given in Rome"));
const bodyLines = rawLines.slice(startIndex, endIndex + 1);
const junkLines = new Set([
  "PM",
  "AI",
  "th",
  "Gen",
  "Mt",
  "Ps",
  "Prov",
  "2 Cor",
  "Encyclical Letter of His Holiness Leo XIV Magnifica Humanitas (15 May 2026)",
]);
const skipAfterHeading = new Set([
  "An examen for the Church",
  "The res novae of our time",
  "Two biblical images",
  "Building for the common good",
  "Remaining human",
  "A Church journeying through human history",
  "The wisdom of the word of God in dialogue with the human sciences",
  "Social Doctrine as a shared discernment",
  "The development of Social Doctrine from Leo XIII to the present",
  "The first stages of the Church's Social Doctrine",
  "The years of the Second Vatican Council",
  "The recent Magisterium",
  "Interpreting history in the light of faith",
  "The foundations of Social Doctrine",
  "The human person: image of the Triune God",
  "The equal dignity of all human beings",
  "The supreme value of human rights",
  "The principles of Social Doctrine",
  "The principle of the common good",
  "The principle of the universal destination of goods",
  "The principle of subsidiarity",
  "The principle of solidarity",
  "The principle of social justice",
  "Integral human development",
  "The technocratic paradigm and digital power",
  "Artificial intelligence",
  "A valuable tool that requires vigilance",
  "Responsibility, transparency and the governance of AI",
  "What must not be lost",
  "Underlying narratives: transhumanism and posthumanism",
  "The limit, the heart, the grandeur of the human person",
  "The authentic \"more than human\": grace and Christian humanism",
  "Two cities and two loves",
  "Truth as a common good",
  "Truth and democracy",
  "Communication and the collective imagination",
  "Toward an ecology of communication",
  "An educational alliance for the digital age",
  "The central role of schools",
  "The dignity of work at a time of digital transition",
  "The value of work",
  "The problem of unemployment",
  "An economy that values dignity",
  "Families and young people: the social conditions for hope",
  "Protecting freedom against dependencies and commercialization",
  "Dependencies and societal control",
  "Breaking the chains of new forms of slavery",
  "A shared responsibility",
  "The civilization of love in the digital age",
  "The culture of power",
  "The normalization of war",
  "Force without limits",
  "Weapons and artificial intelligence",
  "The crisis of multilateralism",
  "A supposed political realism",
  "Building the civilization of love",
  "We can all do our part",
  "The need to disarm words",
  "Building peace through justice",
  "Adopting the perspective of victims",
  "Cultivating a healthy realism",
  "Reviving dialogue",
  "The necessity of diplomacy and multilateralism",
  "Praying and hoping",
  "The Word became flesh",
  "One body in Christ",
  "The construction site of our time",
  "The song of hope: the",
  "Magnificat",
]);

function normalizeLine(line) {
  return line
    .trim()
    .replace(/É/g, "...")
    .replace(/Ñ/g, "-")
    .replace(/[ÔÕ]/g, "'")
    .replace(/[ÒÓ]/g, "\"")
    .replace(//g, "i")
    .replace(//g, "e")
    .replace(//g, "e")
    .replace(/\s+/g, " ");
}

function isMajorHeading(line) {
  return /^(INTRODUCTION|CONCLUSION|CHAPTER [A-Z]+)$/.test(line) || /^[A-Z][A-Z .,'-]{12,}$/.test(line);
}

function isNumberedParagraph(line) {
  return /^\d+\.\s+/.test(line);
}

function cleanParagraph(paragraph) {
  return paragraph
    .replace(/-\s+/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

const paragraphs = [];
let current = "";
let pendingSubheading = false;

function flushCurrent() {
  if (current) {
    paragraphs.push(cleanParagraph(current));
    current = "";
  }
}

for (const rawLine of bodyLines) {
  const line = normalizeLine(rawLine);

  if (!line || junkLines.has(line)) continue;

  if (skipAfterHeading.has(line)) {
    flushCurrent();
    pendingSubheading = true;
    continue;
  }

  if (line === "Given in Rome, at Saint Peter's, on 15 May, in the year 2026, the second of my Pontificate." || line === "LEO PP. XIV") {
    flushCurrent();
    paragraphs.push(line);
    pendingSubheading = false;
    continue;
  }

  if (isMajorHeading(line) || isNumberedParagraph(line) || pendingSubheading) {
    flushCurrent();
    current = line;
    pendingSubheading = false;
    continue;
  }

  if (!current) {
    current = line;
  } else if (isMajorHeading(current)) {
    continue;
  } else {
    current += ` ${line}`;
  }
}

flushCurrent();

const cleanedText = `${paragraphs.join("\n\n")}\n`;
await writeFile(inputPath, cleanedText, "utf8");

console.log(JSON.stringify({
  outputPath: inputPath,
  paragraphs: paragraphs.length,
  words: cleanedText.split(/\s+/).filter(Boolean).length,
  characters: cleanedText.length,
}, null, 2));
