import fs from "node:fs/promises";

const DATA_PATH = "data/movies.json";
const HISTORY_PATH = "data/history.json";
const PLAYERS = ["Alec", "Alex", "John", "Jordan", "Cole", "Daniel", "Brett"];

function parseMoney(value) {
  const match = String(value).match(/\$[\d,]+/);
  return match ? Number(match[0].replace(/[$,]/g, "")) : null;
}

function parseDomesticGross(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const patterns = [
    /Domestic Box Office\s*(\$[\d,]+)/i,
    /Domestic Total Gross\s*(\$[\d,]+)/i,
    /Domestic\s*(\$[\d,]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const amount = match ? parseMoney(match[1]) : null;
    if (amount !== null) return amount;
  }

  return null;
}

function domesticGross(movie) {
  return Number(movie.domesticGross ?? movie.domesticgross ?? 0);
}

function revenueUrl(movie) {
  return movie.revenueUrl || movie.revenueurl || "";
}

async function fetchDomesticGross(movie) {
  const url = revenueUrl(movie);
  if (!url) return null;

  const response = await fetch(url, {
    headers: {
      "user-agent": "movie-auction-tracker/1.0 (+https://github.com/)"
    }
  });

  if (!response.ok) {
    throw new Error(`${movie.title}: ${response.status} ${response.statusText}`);
  }

  return parseDomesticGross(await response.text());
}

const data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
const today = new Date().toISOString().slice(0, 10);
let updatedCount = 0;

for (const movie of data.movies) {
  const previousGross = domesticGross(movie);
  const nextGross = await fetchDomesticGross(movie);

  if (nextGross === null) {
    movie.dailychange = 0;
    continue;
  }

  movie.domesticgross = nextGross;
  movie.dailychange = nextGross - previousGross;
  movie.source = new URL(revenueUrl(movie)).hostname.replace(/^www\./, "");
  movie.history = {
    ...(movie.history || {}),
    [today]: nextGross
  };
  updatedCount += 1;
}

data.lastUpdated = new Date().toISOString();

await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
await writeHistorySnapshot(data, today);
console.log(`Updated ${updatedCount} movie revenues.`);

async function writeHistorySnapshot(data, date) {
  let history = { snapshots: [] };

  try {
    history = JSON.parse(await fs.readFile(HISTORY_PATH, "utf8"));
  } catch {
    history = { snapshots: [] };
  }

  const players = Object.fromEntries(PLAYERS.map((player) => [player, 0]));
  const movies = {};

  for (const movie of data.movies) {
    const gross = domesticGross(movie);
    const owner = movie.owner || "Unassigned";
    movies[movie.id] = gross;

    if (owner in players) {
      players[owner] += gross;
    }
  }

  const snapshot = {
    date,
    players,
    movies,
    total: Object.values(players).reduce((sum, value) => sum + value, 0)
  };

  const snapshots = Array.isArray(history.snapshots) ? history.snapshots : [];
  const index = snapshots.findIndex((item) => item.date === date);

  if (index >= 0) {
    snapshots[index] = snapshot;
  } else {
    snapshots.push(snapshot);
  }

  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  history.snapshots = snapshots;

  await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
}
