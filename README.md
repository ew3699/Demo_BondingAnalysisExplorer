# Bonding Analysis Explorer

Interactive bonding analysis interface (ELF, COOP/COHP, COGITO, tight-binding Wannier model).
Test case: BiOCl. Plain static web app — no build step, no installation beyond Python.

## Run it

**Windows:** double-click `Start Interface.bat`. It starts a local web server and opens
http://localhost:8123 in your default browser. Keep the console window open while using
the app; close it to stop the server.

**Mac/Linux (or manually):** from this folder run

```bash
python3 serve.py
```

then open http://localhost:8123. (`serve.py` is a stock Python web server that also disables
browser caching, so the page always reflects the latest files. `python3 -m http.server 8123`
works too, but the browser may then show a stale version after updates — hard-refresh with
Ctrl+F5 / Cmd+Shift+R if so.)

Notes:
- Python must be installed (any version ≥ 3.x): https://www.python.org/downloads/
- An internet connection is needed the first time (three.js and Plotly load from a CDN).
- Opening `index.html` directly as a file will NOT work — the app must be served over
  HTTP (ES modules + data fetching).

## Sharing

Zip this whole folder and send it; the recipient follows the same steps above.
Alternatively, host it on any static web host (GitHub Pages, Netlify, a group web server) —
upload the folder as-is and it works, no server-side code required.

## Layout

- `index.html`, `css/`, `js/` — the app (structure viewer, analysis tabs, Wannier solver web worker)
- `materials/<ID>/` — per-material data: `POSCAR`, `meta.json` (space group, Wannier k-path/basis,
  file manifest), `ELFCAR`, `*.lobster`, `<ID>_hr.dat`, `bands.dat`, `cogito/*.html`
- Add a material by creating a new `materials/<ID>/` folder with the same file conventions
  (tabs appear based on what `meta.json` declares).
