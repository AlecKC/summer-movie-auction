import fs from "node:fs/promises";

const raw = await fs.readFile("data/movies.json", "utf8");
const data = JSON.parse(raw);

if (!Array.isArray(data.movies)) {
  throw new Error("data/movies.json must contain a movies array.");
}

const ids = new Set();

function numericField(movie, field) {
  if (field === "domesticGross") return movie.domesticGross ?? movie.domesticgross ?? 0;
  if (field === "dailyChange") return movie.dailyChange ?? movie.dailychange ?? 0;
  return movie[field] ?? 0;
}

for (const [index, movie] of data.movies.entries()) {
  for (const field of ["id", "title", "owner"]) {
    if (!movie[field]) {
      throw new Error(`Movie at index ${index} is missing ${field}.`);
    }
  }

  if (ids.has(movie.id)) {
    throw new Error(`Duplicate movie id: ${movie.id}`);
  }

  ids.add(movie.id);

  for (const field of ["domesticGross", "dailyChange", "point_cost"]) {
    if (!Number.isFinite(Number(numericField(movie, field)))) {
      throw new Error(`${movie.title} has an invalid ${field}.`);
    }
  }
}

console.log(`Validated ${data.movies.length} movies.`);

try {
  const history = JSON.parse(await fs.readFile("data/history.json", "utf8"));

  if (!Array.isArray(history.snapshots)) {
    throw new Error("data/history.json must contain a snapshots array.");
  }

  for (const [index, snapshot] of history.snapshots.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date || "")) {
      throw new Error(`History snapshot at index ${index} has an invalid date.`);
    }

    if (!snapshot.players || typeof snapshot.players !== "object") {
      throw new Error(`History snapshot ${snapshot.date} is missing players.`);
    }
  }

  console.log(`Validated ${history.snapshots.length} history snapshots.`);
} catch (error) {
  if (error.code === "ENOENT") {
    console.log("No data/history.json file found.");
  } else {
    throw error;
  }
}
