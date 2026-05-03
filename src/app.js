const PLAYERS = ["Alec", "Alex", "John", "Jordan", "Cole", "Daniel", "Brett"];
const PLAYER_META = {
  Alec: { color: "#8b5cf6", className: "violet" },
  Alex: { color: "#38bdf8", className: "sky" },
  John: { color: "#34d399", className: "emerald" },
  Jordan: { color: "#fde047", className: "yellow" },
  Cole: { color: "#fb923c", className: "orange" },
  Daniel: { color: "#60a5fa", className: "blue" },
  Brett: { color: "#f472b6", className: "pink" },
  Unassigned: { color: "#a3a3a3", className: "neutral" }
};

const START = "2026-04-30";
const END = "2026-09-21";
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});
const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

let state = {
  data: { movies: [] },
  history: { snapshots: [] },
  owners: [],
  openOwners: new Set(),
  compared: new Set(),
  graphPlayer: "All",
  graphPeriod: "day",
  graphCumulative: true
};

function money(value) {
  return currency.format(Number(value || 0));
}

function shortMoney(value) {
  const amount = Number(value || 0);
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(1)}B`;
  if (amount >= 1000000) return `$${Math.round(amount / 1000000)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return money(amount);
}

function plusMoney(value) {
  const amount = Number(value || 0);
  return `${amount >= 0 ? "+" : ""}${money(amount)}`;
}

function domesticGross(movie) {
  return Number(movie.domesticGross ?? movie.domesticgross ?? 0);
}

function dailyChange(movie) {
  return Number(movie.dailyChange ?? movie.dailychange ?? 0);
}

function points(movie) {
  return Number(movie.point_cost ?? movie.points ?? 0);
}

function domesticPerPoint(movie) {
  const cost = points(movie);
  return cost > 0 ? domesticGross(movie) / cost : null;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function keyFor(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function seasonDays() {
  const start = parseDate(state.data.seasonStart || START);
  const end = parseDate(state.data.seasonEnd || END);
  const days = [];

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    days.push(new Date(date));
  }

  return days;
}

function dateDiff(start, end) {
  return Math.round((end - start) / 86400000);
}

function ownersFromMovies(movies) {
  const owners = new Map(PLAYERS.map((name) => [name, {
    name,
    total: 0,
    daily: 0,
    unspent_points: 100,
    movies: []
  }]));

  for (const movie of movies) {
    const name = movie.owner || "Unassigned";
    const owner = owners.get(name) || { name, total: 0, daily: 0, movies: [] };
    owner.total += domesticGross(movie);
    owner.daily += dailyChange(movie);
    owner.unspent_points -= points(movie);
    owner.movies.push(movie);
    owners.set(name, owner);
  }

  return [...owners.values()].sort((a, b) => (b.total + b.unspent_points) - (a.total + a.unspent_points));
}

function movieDailyValues(movie) {
  if (Array.isArray(movie.domesticDaily) && movie.domesticDaily.length) {
    return new Map(movie.domesticDaily.map((entry) => [normalizeShortDate(entry.date), Number(entry.value || 0)]));
  }

  if (movie.history && typeof movie.history === "object") {
    const sorted = Object.entries(movie.history).sort(([a], [b]) => a.localeCompare(b));
    const daily = new Map();
    let previous = 0;

    for (const [date, value] of sorted) {
      const next = Number(value || 0);
      daily.set(date, Math.max(next - previous, 0));
      previous = next;
    }

    return daily;
  }

  return generatedMovieDaily(movie);
}

function normalizeShortDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [month, day] = value.split("/").map(Number);
  const year = Number(state.data.seasonYear || parseDate(START).getFullYear());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function generatedMovieDaily(movie) {
  const gross = domesticGross(movie);
  const release = parseDate(movie.releaseDate || START);
  const map = new Map();
  if (!gross) return map;

  let remaining = gross;
  const weights = [];
  for (let i = 0; i < 56; i += 1) {
    const weekendBoost = [0, 1, 2].includes((release.getDay() + i) % 7) ? 1.7 : 0.72;
    weights.push(Math.pow(0.91, i) * weekendBoost);
  }
  const sum = weights.reduce((total, value) => total + value, 0);

  weights.forEach((weight, index) => {
    const date = new Date(release);
    date.setDate(date.getDate() + index);
    const amount = index === weights.length - 1 ? remaining : Math.round((gross * weight) / sum);
    remaining -= amount;
    map.set(keyFor(date), Math.max(amount, 0));
  });

  return map;
}

function aggregateRows() {
  if (state.graphPlayer === "All" && Array.isArray(state.history.snapshots) && state.history.snapshots.length) {
    return aggregateHistoricalPlayerRows();
  }

  const days = seasonDays();
  const keys = state.graphPlayer === "All"
    ? PLAYERS
    : state.owners.find((owner) => owner.name === state.graphPlayer)?.movies.map((movie) => movie.title) || [];
  const rows = days.map((date) => ({ date: displayDate(date), rawDate: keyFor(date) }));
  const movieDaily = new Map(state.data.movies.map((movie) => [movie.id, movieDailyValues(movie)]));
  const running = Object.fromEntries(keys.map((key) => [key, 0]));

  for (const row of rows) {
    for (const key of keys) row[key] = state.graphCumulative ? running[key] : 0;

    for (const movie of state.data.movies) {
      const playerKey = state.graphPlayer === "All" ? movie.owner : movie.title;
      if (!keys.includes(playerKey)) continue;

      const amount = movieDaily.get(movie.id)?.get(row.rawDate) || 0;
      if (state.graphCumulative) {
        running[playerKey] += amount;
        row[playerKey] = running[playerKey];
      } else {
        row[playerKey] += amount;
      }
    }
  }

  return compressRows(rows, keys);
}

function aggregateHistoricalPlayerRows() {
  const days = seasonDays();
  const snapshots = new Map(state.history.snapshots.map((snapshot) => [snapshot.date, snapshot.players || {}]));
  let latest = Object.fromEntries(PLAYERS.map((player) => [player, 0]));
  const rows = days.map((date) => {
    const rawDate = keyFor(date);
    if (snapshots.has(rawDate)) {
      latest = { ...latest, ...snapshots.get(rawDate) };
    }

    return {
      date: displayDate(date),
      rawDate,
      ...Object.fromEntries(PLAYERS.map((player) => [player, Number(latest[player] || 0)]))
    };
  });

  if (!state.graphCumulative) {
    let previous = Object.fromEntries(PLAYERS.map((player) => [player, 0]));
    for (const row of rows) {
      for (const player of PLAYERS) {
        const next = Number(row[player] || 0);
        row[player] = Math.max(next - previous[player], 0);
        previous[player] = next;
      }
    }
  }

  return compressRows(rows, PLAYERS);
}

function compressRows(rows, keys) {
  if (state.graphPeriod === "day") return { rows, keys };

  const grouped = new Map();
  for (const row of rows) {
    const date = parseDate(row.rawDate);
    const group = state.graphPeriod === "week"
      ? `W${Math.floor(dateDiff(parseDate(state.data.seasonStart || START), date) / 7) + 1}`
      : `${date.getMonth() + 1}/${date.getFullYear().toString().slice(2)}`;
    const current = grouped.get(group) || { date: group, rawDate: row.rawDate };

    for (const key of keys) {
      current[key] = state.graphCumulative ? row[key] : Number(current[key] || 0) + Number(row[key] || 0);
    }

    grouped.set(group, current);
  }

  return { rows: [...grouped.values()], keys };
}

function renderUpdated() {
  const el = document.querySelector("#last-updated");
  if (!state.data.lastUpdated) {
    el.textContent = "Last updated at";
    return;
  }

  const date = new Date(state.data.lastUpdated);
  el.dateTime = date.toISOString();
  el.textContent = `Last updated at ${dateTime.format(date)}`;
}

function renderLeaderboard() {
  const list = document.querySelector("#leaderboard-list");
  list.innerHTML = state.owners.map((owner, index) => {
    const meta = PLAYER_META[owner.name] || PLAYER_META.Unassigned;
    const isOpen = state.openOwners.has(owner.name);
    const compared = state.compared.has(owner.name);
    return `
      <article class="leader-entry">
        <div class="leader-header ${isOpen ? "is-open" : ""}" data-owner-toggle="${owner.name}" role="button" tabindex="0">
          <h2>
            <span class="rank">${index + 1}</span>
            <span class="score-pill ${meta.className}">
              <span>${owner.name} scored</span>
              <span>${money(owner.total)} + ${money(owner.unspent_points)}</span>
            </span>
            <label class="compare-control" data-stop-toggle>
              <span>Compare</span>
              <input type="checkbox" data-compare="${owner.name}" ${compared ? "checked" : ""}>
            </label>
          </h2>
          <svg class="plus-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect y="7" width="16" height="2" rx="1"></rect>
            <rect y="7" width="16" height="2" rx="1" class="vertical"></rect>
          </svg>
        </div>
        <div class="owner-region ${isOpen ? "is-open" : ""}">
          <div>
            ${renderOwnerMovies(owner)}
          </div>
        </div>
      </article>
    `;
  }).join("");

  wireLeaderboard();
  renderCompareDock();
}

function renderOwnerMovies(owner) {
  if (!owner.movies.length) {
    return `<p class="empty-owner">No movies yet.</p>`;
  }

  return `
    <div class="owner-movie-table-wrap">
      <table class="owner-movie-table">
        <thead>
          <tr>
            <th scope="col">Movie</th>
            <th scope="col">Points</th>
            <th scope="col">Domestic</th>
            <th scope="col">Domestic / Point</th>
          </tr>
        </thead>
        <tbody>
          ${owner.movies
            .sort((a, b) => domesticGross(b) - domesticGross(a))
            .map((movie) => `
              <tr>
                <td>
                  <strong>${movie.title}</strong>
                  <span>${movie.releaseDate || "TBD"}</span>
                </td>
                <td class="number">${points(movie) || "-"}</td>
                <td class="number">${money(domesticGross(movie))}</td>
                <td class="number">${domesticPerPoint(movie) === null ? "-" : money(domesticPerPoint(movie))}</td>
              </tr>
            `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function wireLeaderboard() {
  document.querySelectorAll("[data-owner-toggle]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("[data-stop-toggle]")) return;
      const owner = row.dataset.ownerToggle;
      if (state.openOwners.has(owner)) state.openOwners.delete(owner);
      else state.openOwners.add(owner);
      renderLeaderboard();
    });
  });

  document.querySelectorAll("[data-compare]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.compared.add(input.dataset.compare);
      else state.compared.delete(input.dataset.compare);

      if (state.compared.size > 2) {
        const oldest = state.compared.values().next().value;
        state.compared.delete(oldest);
      }

      renderLeaderboard();
    });
  });
}

function renderCompareDock() {
  const dock = document.querySelector("#compare-dock");
  const compared = [...state.compared];

  if (!compared.length) {
    dock.hidden = true;
    dock.innerHTML = "";
    return;
  }

  dock.hidden = false;
  if (compared.length === 1) {
    dock.innerHTML = `
      <span>${badge(compared[0])}</span>
      <strong>Select another to compare</strong>
    `;
    return;
  }

  const [first, second] = compared;
  const a = state.owners.find((owner) => owner.name === first)?.total || 0;
  const b = state.owners.find((owner) => owner.name === second)?.total || 0;
  const lead = Math.abs(a - b);
  dock.innerHTML = `
    <span>${badge(first)} ${a > b ? `leads by ${money(lead)}` : ""}</span>
    <span>${badge(second)} ${b > a ? `leads by ${money(lead)}` : ""}</span>
  `;
}

function badge(name) {
  const meta = PLAYER_META[name] || PLAYER_META.Unassigned;
  return `<span class="score-pill ${meta.className}"><span>${name}</span></span>`;
}

function renderGraphControls() {
  const select = document.querySelector("#graph-player");
  select.innerHTML = [
    `<option value="All">All</option>`,
    ...PLAYERS.map((player) => `<option value="${player}">${player}</option>`)
  ].join("");
  select.value = state.graphPlayer;
  document.querySelector("#graph-period").value = state.graphPeriod;
  document.querySelector("#graph-cumulative").checked = state.graphCumulative;

  select.addEventListener("change", () => {
    state.graphPlayer = select.value;
    renderGraphs();
  });
  document.querySelector("#graph-period").addEventListener("change", (event) => {
    state.graphPeriod = event.target.value;
    renderGraphs();
  });
  document.querySelector("#graph-cumulative").addEventListener("change", (event) => {
    state.graphCumulative = event.target.checked;
    renderGraphs();
  });
}

function renderGraphs() {
  const { rows, keys } = aggregateRows();
  renderLineChart(rows, keys);
  renderStackedChart();
}

function renderLineChart(rows, keys) {
  const container = document.querySelector("#line-chart");
  const legend = document.querySelector("#chart-legend");
  const width = 980;
  const height = 400;
  const margin = { top: 8, right: 30, bottom: 34, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // determine data max and make axis max 20% larger
  const dataMaxRaw = Math.max(0, ...rows.flatMap((row) => keys.map((key) => Number(row[key] || 0))));
  const axisMax = dataMaxRaw > 0 ? Math.ceil(dataMaxRaw * 1.2) : 1;
  const max = Math.max(1, axisMax);

  // ticks: 25%, 50%, 75% of the data max, and the axis max
  const yTicks = dataMaxRaw > 0
    ? [
        Math.round(dataMaxRaw * 0.25),
        Math.round(dataMaxRaw * 0.5),
        Math.round(dataMaxRaw * 0.75),
        axisMax
      ]
    : [0, axisMax];

  const x = (index) => margin.left + (index / Math.max(rows.length - 1, 1)) * plotWidth;
  const y = (value) => margin.top + plotHeight - (Number(value || 0) / max) * plotHeight;
  const xStep = Math.max(1, Math.ceil(rows.length / 8));
  const xTicks = rows.filter((_, index) => index % xStep === 0 || index === rows.length - 1);

  const paths = keys.map((key, keyIndex) => {
    const color = PLAYER_META[key]?.color || colorForIndex(keyIndex);
    const path = rows.map((row, index) => `${index ? "L" : "M"} ${x(index).toFixed(2)} ${y(row[key]).toFixed(2)}`).join(" ");
    return `<path class="series-line" data-key="${key}" d="${path}" stroke="${color}"></path>`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart" role="img">
      <title>Revenue over time</title>
      ${yTicks.map((tick) => `
        <g class="axis-text">
          <line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"></line>
          <text x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">$${Math.round(tick / 1000000)}M</text>
        </g>
      `).join("")}
      ${xTicks.map((row) => `
        <text class="axis-label" x="${x(rows.indexOf(row))}" y="${height - 10}" text-anchor="middle">${row.date}</text>
      `).join("")}
      <line class="axis-line" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
      <line class="axis-line" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
      ${paths}
      <g class="tooltip-layer" hidden>
        <line class="hover-line" x1="0" x2="0" y1="${margin.top}" y2="${height - margin.bottom}"></line>
        <rect class="tooltip-box" x="0" y="0" width="230" height="170" rx="4"></rect>
        <text class="tooltip-text" x="0" y="0"></text>
      </g>
      <rect class="hit-area" x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}"></rect>
    </svg>
  `;

  legend.innerHTML = keys.map((key, index) => `
    <span data-legend="${key}"><i style="background:${PLAYER_META[key]?.color || colorForIndex(index)}"></i>${key}</span>
  `).join("");

  wireLineHover(container, rows, keys, { width, height, margin, plotWidth, x });
  wireLegend(container);
}

function wireLineHover(container, rows, keys, chart) {
  const svg = container.querySelector("svg");
  const hit = container.querySelector(".hit-area");
  const layer = container.querySelector(".tooltip-layer");
  const hoverLine = container.querySelector(".hover-line");
  const box = container.querySelector(".tooltip-box");
  const text = container.querySelector(".tooltip-text");

  hit.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const scale = chart.width / rect.width;
    const svgX = (event.clientX - rect.left) * scale;
    const index = Math.min(rows.length - 1, Math.max(0, Math.round(((svgX - chart.margin.left) / chart.plotWidth) * (rows.length - 1))));
    const row = rows[index];
    const xPos = chart.x(index);
    const boxX = xPos > chart.width - 270 ? xPos - 250 : xPos + 14;
    const boxY = chart.margin.top + 12;

    hoverLine.setAttribute("x1", xPos);
    hoverLine.setAttribute("x2", xPos);
    box.setAttribute("x", boxX);
    box.setAttribute("y", boxY);
    text.setAttribute("x", boxX + 12);
    text.setAttribute("y", boxY + 22);
    text.innerHTML = `
      <tspan x="${boxX + 12}" dy="0">${row.date}</tspan>
      ${keys
        .map((key) => ({ key, value: row[key] || 0 }))
        .sort((a, b) => b.value - a.value)
        .map((item, rowIndex) => `<tspan x="${boxX + 12}" dy="${rowIndex ? 20 : 26}" fill="${PLAYER_META[item.key]?.color || "#fff"}">${item.key}: ${money(item.value)}</tspan>`)
        .join("")}
    `;
    layer.hidden = false;
  });

  hit.addEventListener("pointerleave", () => {
    layer.hidden = true;
  });
}

function wireLegend(container) {
  document.querySelectorAll("[data-legend]").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      const key = item.dataset.legend;
      container.querySelectorAll(".series-line").forEach((line) => {
        line.classList.toggle("is-muted", line.dataset.key !== key);
        line.classList.toggle("is-focused", line.dataset.key === key);
      });
    });
    item.addEventListener("mouseleave", () => {
      container.querySelectorAll(".series-line").forEach((line) => line.classList.remove("is-muted", "is-focused"));
    });
  });
}

function renderStackedChart() {
  const container = document.querySelector("#stacked-chart");
  const owners = state.owners.filter((owner) => owner.movies.length);
  const max = Math.max(1, ...owners.map((owner) => owner.total));

  container.innerHTML = `
    <h2>Movie contribution</h2>
    <div class="stack-chart">
      ${owners.map((owner) => `
        <section class="stack-row">
          <div class="stack-name">
            <span>${owner.name}</span>
            <strong>${money(owner.total)}</strong>
          </div>
          <div class="stack-track-wrap">
            <div class="stack-track" style="width:${(owner.total / max) * 100}%">
              ${owner.movies.map((movie, index) => `
                <span style="width:${owner.total ? (domesticGross(movie) / owner.total) * 100 : 0}%;background:${colorForIndex(index)}" title="${movie.title}: ${money(domesticGross(movie))}"></span>
              `).join("")}
            </div>
          </div>
          <div class="stack-labels">
            ${owner.movies.map((movie) => `<span>${movie.title} <b>${shortMoney(domesticGross(movie))}</b></span>`).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function colorForIndex(index) {
  return ["#8b5cf6", "#38bdf8", "#34d399", "#fde047", "#fb923c", "#60a5fa", "#f472b6", "#f87171", "#a78bfa"][index % 9];
}

function renderMovies() {
  const body = document.querySelector("#movie-table");
  body.innerHTML = [...state.data.movies]
    .sort((a, b) => domesticGross(b) - domesticGross(a))
    .map((movie) => `
      <tr>
        <td>${movie.title}</td>
        <td>${movie.owner || ""}</td>
        <td>${movie.releaseDate || "TBD"}</td>
        <td class="number">${money(domesticGross(movie))}</td>
        <td class="number">${plusMoney(dailyChange(movie))}</td>
      </tr>
    `).join("");
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("is-active", button === tab));
      document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === `${tab.dataset.view}-view`);
      });
    });
  });
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

async function main() {
  state.data = await loadJson("data/movies.json", { movies: [] });
  state.history = await loadJson("data/history.json", { snapshots: [] });
  state.owners = ownersFromMovies(state.data.movies || []);

  renderUpdated();
  renderLeaderboard();
  renderGraphControls();
  renderGraphs();
  renderMovies();
  wireTabs();
}

main().catch((error) => {
  document.body.innerHTML = `<main><h1>could not load tracker data</h1><p>${error.message}</p></main>`;
});
