import { parsePoscar } from './poscar.js';
import { Structure } from './structure.js';
import { StructureViewer } from './viewer.js';
import { elementData } from './elements.js';
// Tab modules are imported eagerly so a hard refresh (Ctrl+F5) always picks up
// the whole app at once — lazy imports would otherwise be served from the old
// browser cache. Data files are still only fetched when a tab is first opened.
import { initElfTab } from './tabs/elf.js';
import { initCohpTab } from './tabs/cohp.js';
import { initCogitoTab } from './tabs/cogito.js';
import { initWannierTab } from './tabs/wannier.js';

const MATERIAL_ID = 'BiOCl';

// ---- Bonding-analysis tabs ----
// Tabs with an `init` load a module on first activation; the rest render placeholders.
const TABS = {
  elf: { init: initElfTab },
  cohp: { init: initCohpTab },
  cogito: { init: initCogitoTab },
  wannier: { init: initWannierTab },
};

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url} (HTTP ${r.status})`);
  return r.text();
}

// Prefer the conventional formula string from meta.json (e.g. "BiOCl");
// fall back to POSCAR element order. Digits become subscripts.
function formulaHtml(structure, meta) {
  if (meta?.formula) return meta.formula.replace(/(\d+)/g, '<sub>$1</sub>');
  return structure.reducedFormula
    .map(([el, n]) => `${el}${n > 1 ? `<sub>${n}</sub>` : ''}`)
    .join('');
}

function fillDetails(structure, meta) {
  const { a, b, c, alpha, beta, gamma } = structure.latticeParams;
  const sg = meta.spaceGroup ?? {};
  const rows = [
    ['Formula', formulaHtml(structure, meta)],
    ['Space group', sg.symbol ? `${sg.symbol} (#${sg.number})` : '—'],
    ['Crystal system', sg.crystalSystem ?? '—'],
    ['Point group', sg.pointGroup ?? '—'],
    ['a, b, c (Å)', `${a.toFixed(4)}, ${b.toFixed(4)}, ${c.toFixed(4)}`],
    ['α, β, γ (°)', `${alpha.toFixed(2)}, ${beta.toFixed(2)}, ${gamma.toFixed(2)}`],
    ['Cell volume (Å³)', structure.volume.toFixed(2)],
    ['Density (g/cm³)', structure.density.toFixed(3)],
    ['Sites per cell', structure.sites.length],
  ];
  document.getElementById('details-table').innerHTML = rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join('');
}

function fillSites(structure, meta) {
  const wyckoff = meta.wyckoff ?? {};
  const header = '<tr><th>Species</th><th>Wyckoff</th><th>x</th><th>y</th><th>z</th><th title="Electronegativity, Pauling scale (PubChem)">χ</th></tr>';
  const rows = structure.sites.map((s) => {
    const { color, electronegativity } = elementData(s.element);
    const [x, y, z] = s.frac.map((v) => v.toFixed(4));
    return `<tr>
      <td><span class="el-dot" style="background:${color}"></span>${s.label ?? s.element}</td>
      <td>${wyckoff[s.element] ?? '—'}</td>
      <td>${x}</td><td>${y}</td><td>${z}</td>
      <td>${electronegativity?.toFixed(2) ?? '—'}</td>
    </tr>`;
  });
  document.getElementById('sites-table').innerHTML = header + rows.join('');
}

function fillLegend(structure) {
  document.getElementById('viewer-legend').innerHTML = [...structure.composition.keys()]
    .map((el) => {
      const { color } = elementData(el);
      return `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${el}</span>`;
    })
    .join('');
}

function buildTabs(ctx) {
  const panels = document.getElementById('tab-panels');
  const bar = document.getElementById('tab-bar');
  const hosts = {};
  const initialized = new Set();

  for (const key of Object.keys(TABS)) {
    const host = document.createElement('div');
    host.hidden = true;
    panels.appendChild(host);
    hosts[key] = host;
    const t = TABS[key];
    if (!t.init) {
      host.innerHTML = `
        <div class="tab-panel">
          <h3>${t.title}<span class="pill">Awaiting data</span></h3>
          <p class="panel-desc">${t.desc}</p>
          <div class="expects">
            Expected input for this tab:
            <ul>${t.expects.map((e) => `<li>${e}</li>`).join('')}</ul>
          </div>
        </div>`;
    }
  }

  // Panels persist across switches (keeps WebGL contexts alive); modules init once.
  function activate(key) {
    bar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    for (const [k, host] of Object.entries(hosts)) host.hidden = k !== key;
    const t = TABS[key];
    if (t.init && !initialized.has(key)) {
      initialized.add(key);
      t.init(hosts[key], ctx).catch((err) => {
        hosts[key].innerHTML = `<div class="tab-panel"><p class="panel-desc">Failed to load: ${err.message}</p></div>`;
        console.error(err);
      });
    }
  }

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) activate(btn.dataset.tab);
  });

  activate('elf');
}

async function init() {
  const [poscarText, metaText] = await Promise.all([
    fetchText(`materials/${MATERIAL_ID}/POSCAR`),
    fetchText(`materials/${MATERIAL_ID}/meta.json`),
  ]);
  const meta = JSON.parse(metaText);
  const structure = new Structure(parsePoscar(poscarText));

  // Title block
  document.getElementById('crumb-material').textContent = meta.id;
  document.getElementById('material-formula').innerHTML = formulaHtml(structure, meta);
  document.getElementById('material-name').textContent = `${meta.name} — ${meta.description}`;
  const sg = meta.spaceGroup ?? {};
  document.getElementById('title-tags').innerHTML = [
    sg.symbol && `<span class="tag">${sg.symbol}</span>`,
    sg.crystalSystem && `<span class="tag">${sg.crystalSystem}</span>`,
    `<span class="tag">${structure.sites.length} sites</span>`,
  ].filter(Boolean).join('');

  fillDetails(structure, meta);
  fillSites(structure, meta);
  fillLegend(structure);
  buildTabs({ structure, meta, materialId: MATERIAL_ID });

  // Viewer
  const statusEl = document.getElementById('viewer-status');
  const defaultStatus = statusEl.textContent;
  const viewer = new StructureViewer(document.getElementById('viewer'), {
    tooltip: document.getElementById('viewer-tooltip'),
    onStatus: (msg) => { statusEl.textContent = msg || defaultStatus; },
  });
  viewer.setStructure(structure);

  document.getElementById('supercell-select').addEventListener('change', (e) => {
    viewer.setSupercell(e.target.value.split(',').map(Number));
  });
  document.getElementById('toggle-bonds').addEventListener('change', (e) =>
    viewer.setOptions({ showBonds: e.target.checked }));
  document.getElementById('toggle-cell').addEventListener('change', (e) =>
    viewer.setOptions({ showCell: e.target.checked }));
  document.getElementById('toggle-labels').addEventListener('change', (e) =>
    viewer.setOptions({ showLabels: e.target.checked }));
  document.getElementById('reset-view').addEventListener('click', () => viewer.resetCamera());

  document.getElementById('page').hidden = false;
}

init().catch((err) => {
  const el = document.getElementById('load-error');
  el.textContent = `Failed to initialize: ${err.message}. Make sure the app is served over HTTP (py -m http.server) rather than opened as a file.`;
  el.hidden = false;
  console.error(err);
});
