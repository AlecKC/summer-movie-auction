# Summer Movie Auction Tracker

A static website for tracking a movie auction leaderboard with owner totals and daily domestic box office updates.

## Edit Your Movie List

Update `data/movies.json`:

```json
{
  "id": "mission-impossible-final-reckoning",
  "title": "Mission: Impossible - The Final Reckoning",
  "owner": "Alec",
  "releaseDate": "2025-05-23",
  "domesticGross": 0,
  "dailyChange": 0,
  "revenueUrl": "https://www.the-numbers.com/movie/Mission-Impossible-The-Final-Reckoning-(2025)#tab=box-office",
  "source": "the-numbers.com"
}
```

Use a stable movie page from The Numbers or Box Office Mojo in `revenueUrl`. If no URL is provided, the site keeps that movie as a manual entry.

## Run Locally

```bash
npm install
npm start
```

Then open `http://localhost:5173`.

## Update Revenues

```bash
npm run update:revenues
```

The script fetches each `revenueUrl`, finds the domestic total, updates `domesticGross`, calculates `dailyChange`, and stamps `lastUpdated`.
It also stores each daily value in `movie.history` and records player/movie snapshots in `data/history.json`, which powers the cumulative line graph over the season.

## Deploy With GitHub Pages

1. Create a GitHub repository and push this project.
2. In GitHub, go to Settings -> Pages.
3. Set Source to "Deploy from a branch".
4. Choose your default branch and `/root`.
5. In Settings -> Pages, add your custom domain.
6. In GoDaddy DNS, point the domain at GitHub Pages:

For an apex domain like `example.com`, add these A records:

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

For `www.example.com`, add a CNAME record pointing to:

```text
YOUR-GITHUB-USERNAME.github.io
```

After DNS propagates, enable "Enforce HTTPS" in GitHub Pages.

## Daily Updates

The included GitHub Actions workflow runs once per day at 13:20 UTC. You can also trigger it manually from the Actions tab.
