import fs from "node:fs/promises";
import * as cheerio from "cheerio";

const DATA_PATH = "data/movies.json";
const HISTORY_PATH = "data/history.json";
const PLAYERS = ["Alec", "Alex", "John", "Jordan", "Cole", "Daniel", "Brett"];
const REQUEST_HEADERS = {
  "user-agent": "movie-auction-tracker/1.0 (+https://github.com/)"
};

function parseMoney(value) {
  const normalized = String(value || "").replace(/\u00a0/g, " ");
  const match = normalized.match(/-?\$?[\d,]+/);
  return match ? Number(match[0].replace(/[$,]/g, "")) : null;
}

async function parseDataTables(url) {
  const response = await fetch(url, { headers: REQUEST_HEADERS });

  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const data = [];

  $("table tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((_, td) => $(td).text().trim())
      .get();
  
    data.push({
      date: cells[0],
      dow: cells[1],
      rank: cells[2],
      daily: cells[3],
      percentYD: cells[4],
      percentLW: cells[5],
      theaters: cells[6], 
      avg: cells[7],
      toDate: cells[8],
      day: cells[9],
    });
  });

  return data.filter((row) => row.date && row.toDate);
}

function domesticGross(movie) {
  return Number(movie.domesticGross ?? movie.domesticgross ?? 0);
}

function revenueUrl(movie) {
  return movie.revenueUrl || movie.revenueurl || "";
}

function normalizeTableDate(value, fallbackYear) {
  const text = String(value || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const monthDayYear = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (monthDayYear) {
    const [, month, day, yearText] = monthDayYear;
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const monthDay = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (monthDay) {
    const [, month, day] = monthDay;
    return `${fallbackYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(`${text} ${fallbackYear}`);
  if (!Number.isNaN(parsed.valueOf())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }

  return null;
}

function releaseYear(movie) {
  return Number(String(movie.releaseDate || "").slice(0, 4)) || new Date().getFullYear();
}

function rowsToHistory(movie, rows) {
  const fallbackYear = releaseYear(movie);
  const history = {};

  for (const row of rows) {
    const date = normalizeTableDate(row.date, fallbackYear);
    const cumulative = parseMoney(row.toDate);

    if (!date || cumulative === null) continue;
    history[date] = cumulative;
  }

  return Object.fromEntries(Object.entries(history).sort(([a], [b]) => a.localeCompare(b)));
}

async function fetchMovieHistory(movie) {
  const url = revenueUrl(movie);
  if (!url) return null;

  return rowsToHistory(movie, await parseDataTables(url));
}

const data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
const today = new Date().toISOString().slice(0, 10);
let updatedCount = 0;

for (const movie of data.movies) {
  const previousGross = domesticGross(movie);
  const history = await fetchMovieHistory(movie);

  if (!history || !Object.keys(history).length) {
    movie.dailychange = 0;
    continue;
  }

  const historyEntries = Object.entries(history).sort(([a], [b]) => a.localeCompare(b));
  const [latestDate, nextGross] = historyEntries.at(-1);
  const priorEntry = historyEntries.at(-2);
  const priorGross = priorEntry ? priorEntry[1] : previousGross;

  movie.domesticgross = nextGross;
  movie.dailychange = nextGross - priorGross;
  movie.source = new URL(revenueUrl(movie)).hostname.replace(/^www\./, "");
  movie.history = history;
  movie.lastRevenueDate = latestDate;
  updatedCount += 1;
}

data.lastUpdated = new Date().toISOString();

await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
await rebuildHistorySnapshots(data);
console.log(`Updated ${updatedCount} movie revenues.`);

async function rebuildHistorySnapshots(data) {
  const dates = new Set();

  for (const movie of data.movies) {
    for (const date of Object.keys(movie.history || {})) {
      dates.add(date);
    }
  }

  const runningMovieTotals = Object.fromEntries(data.movies.map((movie) => [movie.id, 0]));
  const snapshots = [...dates].sort().map((date) => {
    const players = Object.fromEntries(PLAYERS.map((player) => [player, 0]));
    const movies = {};

    for (const movie of data.movies) {
      if (movie.history && date in movie.history) {
        runningMovieTotals[movie.id] = Number(movie.history[date] || 0);
      }

      const gross = runningMovieTotals[movie.id] || 0;
      const owner = movie.owner || "Unassigned";
      movies[movie.id] = gross;

      if (owner in players) {
        players[owner] += gross;
      }
    }

    return {
      date,
      players,
      movies,
      total: Object.values(players).reduce((sum, value) => sum + value, 0)
    };
  });

  await fs.writeFile(HISTORY_PATH, `${JSON.stringify({ snapshots }, null, 2)}\n`);
}
