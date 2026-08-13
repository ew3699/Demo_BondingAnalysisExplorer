// COOP / COHP / COBI tab from LOBSTER output.
// Convention: energy axis is E − E_F (LOBSTER files are pre-shifted); COHP is plotted
// as −pCOHP so bonding points right; COOP/COBI are plotted as-is (bonding positive).

const MODES = {
  cohp: { car: 'cohp', ilist: 'icohp', axis: '−pCOHP (bonding →)', ival: 'ICOHP (eV)', negate: true },
  coop: { car: 'coop', ilist: 'icoop', axis: 'pCOOP (bonding →)', ival: 'ICOOP', negate: false },
  cobi: { car: 'cobi', ilist: 'icobi', axis: 'pCOBI (bonding →)', ival: 'ICOBI', negate: false },
};

const GROUP_COLORS = { 'Bi–O': '#c0392b', 'Bi–Cl': '#2b8a3e', 'Cl–Cl': '#5b7c99' };
const FALLBACK_GROUP_COLORS = ['#c0392b', '#2b8a3e', '#5b7c99', '#8b3fa8', '#b8860b'];
const NS = 'http://www.w3.org/2000/svg';

export async function initCohpTab(host, ctx) {
  const cfg = ctx.meta.lobster;
  if (!cfg) {
    host.innerHTML = '<div class="tab-panel"><p class="panel-desc">No LOBSTER configuration for this material.</p></div>';
    return;
  }
  host.innerHTML = '<p class="loading-note">Loading LOBSTER data…</p>';

  const fetchText = async (name) => {
    const r = await fetch(`materials/${ctx.materialId}/${name}`);
    if (!r.ok) throw new Error(`HTTP ${r.status} loading ${name}`);
    return r.text();
  };

  // ---- Load & parse all three CAR/ILIST sets (missing files are tolerated) ----
  const data = {};
  for (const key of Object.keys(MODES)) {
    const m = MODES[key];
    if (!cfg[m.car]) continue;
    try {
      data[key] = {
        car: parseCar(await fetchText(cfg[m.car])),
        ilist: cfg[m.ilist] ? parseIlist(await fetchText(cfg[m.ilist])) : null,
      };
    } catch (e) {
      console.warn(`LOBSTER ${key}:`, e);
    }
  }
  if (!data.cohp && !data.coop) {
    host.innerHTML = '<div class="tab-panel"><p class="panel-desc">Could not load COHPCAR/COOPCAR.</p></div>';
    return;
  }

  // Interactions (identical ordering across the three sets — use the first available).
  const first = data.cohp ?? data.coop;
  const pairs = first.car.labels.slice(1).map((lbl, i) => {
    const m = lbl.match(/No\.\d+:([A-Za-z]+)(\d+)->([A-Za-z]+)(\d+)\(([\d.]+)\)/);
    const [elA, elB] = [m[1], m[3]];
    return {
      idx: i, // column i+1 in each CAR file; row i of each ILIST
      a: `${m[1]}${m[2]}`,
      b: `${m[3]}${m[4]}`,
      dist: parseFloat(m[5]),
      group: `${elA}–${elB}`,
    };
  });
  const groups = [...new Set(pairs.map((p) => p.group))];
  const groupColor = (gname) => GROUP_COLORS[gname] ?? FALLBACK_GROUP_COLORS[groups.indexOf(gname) % FALLBACK_GROUP_COLORS.length];

  // Small extras for the summary card.
  const extras = {};
  for (const [key, file] of [['charge', cfg.charge], ['madelung', cfg.madelung], ['polarization', cfg.polarization], ['lobsterout', cfg.lobsterout]]) {
    if (file) { try { extras[key] = await fetchText(file); } catch { /* optional */ } }
  }

  // ---- State ----
  const eAll = first.car.energies;
  const state = {
    mode: data.cohp ? 'cohp' : 'coop',
    emin: Math.max(eAll[0], -8),
    emax: Math.min(eAll[eAll.length - 1], 8),
    showIntegrated: false,
    groupsOn: new Set(groups),
    pairsOn: new Set(),
  };

  // ---- DOM ----
  host.innerHTML = `
    <div class="tab-panel">
      <h3>COOP / COHP Analysis</h3>
      <p class="panel-desc">Projected COHP/COOP/COBI curves from LOBSTER (${pairs.length} interactions,
        energies relative to E<sub>F</sub>). Bond-type curves are averaged per bond; individual pairs can be
        toggled in the table. COHP is drawn as −pCOHP so bonding character points right.</p>
      <div class="wann-settings">
        <span class="seg-toggle" data-id="mode">
          ${Object.keys(MODES).filter((k) => data[k]).map((k, i) =>
            `<button class="seg ${k === state.mode ? 'on' : ''}" data-mode="${k}">${k.toUpperCase()}</button>`).join('')}
        </span>
        <label class="ctl chk"><input type="checkbox" data-id="show-int"> Show integrated (I) panel</label>
        <label class="ctl">E range <input type="number" data-id="emin" value="${state.emin.toFixed(1)}" step="0.5" class="erange">
          to <input type="number" data-id="emax" value="${state.emax.toFixed(1)}" step="0.5" class="erange"></label>
      </div>
      <div class="cohp-layout">
        <div class="wann-plot-card"><svg data-id="plot"></svg></div>
        <div class="wann-plot-card cohp-int-card" data-id="int-card" hidden><svg data-id="int-plot"></svg></div>
        <div class="cohp-table-card">
          <table class="pair-table" data-id="pair-table"></table>
        </div>
      </div>
      <details class="wann-matrix-details lobster-extras">
        <summary>LOBSTER summary — charges, Madelung energy, polarization</summary>
        <div class="extras-grid" data-id="extras"></div>
      </details>
      <details class="wann-matrix-details" data-id="quality-details" hidden>
        <summary>Projection quality — charge spilling &amp; recovered electrons <span data-id="qsum"></span></summary>
        <div class="quality-body" data-id="quality"></div>
      </details>
    </div>`;

  const el = (id) => host.querySelector(`[data-id="${id}"]`);

  // ---- Controls ----
  el('mode').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn || btn.dataset.mode === state.mode) return;
    state.mode = btn.dataset.mode;
    el('mode').querySelectorAll('.seg').forEach((b) => b.classList.toggle('on', b === btn));
    renderTable();
    renderPlots();
  });
  el('show-int').addEventListener('change', () => {
    state.showIntegrated = el('show-int').checked;
    el('int-card').hidden = !state.showIntegrated;
    renderPlots();
  });
  el('emin').addEventListener('change', () => { state.emin = parseFloat(el('emin').value); renderPlots(); });
  el('emax').addEventListener('change', () => { state.emax = parseFloat(el('emax').value); renderPlots(); });

  // ---- Interaction table ----
  function renderTable() {
    const ilist = data[state.mode].ilist;
    const rows = [];
    rows.push(`<tr><th></th><th>Interaction</th><th>cell</th><th>d (Å)</th><th>${MODES[state.mode].ival} @ E<sub>F</sub></th></tr>`);
    for (const gname of groups) {
      const members = pairs.filter((p) => p.group === gname);
      const sum = ilist ? members.reduce((s, p) => s + ilist[p.idx].value, 0) : null;
      rows.push(`<tr class="group-row" style="--gc:${groupColor(gname)}">
        <td><input type="checkbox" data-group="${gname}" ${state.groupsOn.has(gname) ? 'checked' : ''}></td>
        <td><span class="gdot"></span><b>${gname}</b> <span class="soft">(avg of ${members.length})</span></td>
        <td></td><td>${members[0].dist.toFixed(3)}</td>
        <td>${sum !== null ? `Σ ${sum.toFixed(3)}` : ''}</td></tr>`);
      for (const p of members) {
        const il = ilist ? ilist[p.idx] : null;
        rows.push(`<tr class="pair-row">
          <td><input type="checkbox" data-pair="${p.idx}" ${state.pairsOn.has(p.idx) ? 'checked' : ''}></td>
          <td>${p.a}–${p.b}</td>
          <td class="soft">${il ? il.translation.join(' ') : ''}</td>
          <td>${p.dist.toFixed(3)}</td>
          <td>${il ? il.value.toFixed(4) : ''}</td></tr>`);
      }
    }
    el('pair-table').innerHTML = rows.join('');
  }
  el('pair-table').addEventListener('change', (e) => {
    const g = e.target.dataset.group;
    const p = e.target.dataset.pair;
    if (g !== undefined) e.target.checked ? state.groupsOn.add(g) : state.groupsOn.delete(g);
    if (p !== undefined) e.target.checked ? state.pairsOn.add(+p) : state.pairsOn.delete(+p);
    renderPlots();
  });

  // ---- Plotting ----
  const P = { w: 460, h: 520, top: 16, right: 14, bottom: 30, left: 46 };
  const PI = { w: 300, h: 520, top: 16, right: 14, bottom: 30, left: 42 };

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  function seriesList(useIntegrated) {
    const { car } = data[state.mode];
    const sign = MODES[state.mode].negate ? -1 : 1;
    const out = [];
    const curveOf = (colIdx) => (useIntegrated ? car.cols[colIdx].ip : car.cols[colIdx].p);
    for (const gname of groups) {
      if (!state.groupsOn.has(gname)) continue;
      const members = pairs.filter((p) => p.group === gname);
      const y = new Float64Array(eAll.length);
      for (const p of members) {
        const c = curveOf(p.idx + 1);
        for (let i = 0; i < y.length; i++) y[i] += c[i];
      }
      for (let i = 0; i < y.length; i++) y[i] = (sign * y[i]) / members.length;
      out.push({ label: `${gname} (avg)`, y, color: groupColor(gname), width: 1.9 });
    }
    let shadeStep = 0;
    for (const p of pairs) {
      if (!state.pairsOn.has(p.idx)) continue;
      const c = curveOf(p.idx + 1);
      const y = Float64Array.from(c, (v) => sign * v);
      out.push({
        label: `${p.a}–${p.b} [${data[state.mode].ilist?.[p.idx]?.translation.join('') ?? p.idx + 1}]`,
        y,
        color: shadePair(groupColor(p.group), shadeStep++),
        width: 1.2,
        dash: '4 3',
      });
    }
    return out;
  }

  function shadePair(hex, step) {
    const n = parseInt(hex.slice(1), 16);
    const amt = 0.18 + 0.16 * (step % 3);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v + (255 - v) * amt)));
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
  }

  function drawPanel(svg, PP, series, axisLabel) {
    const iw = PP.w - PP.left - PP.right;
    const ih = PP.h - PP.top - PP.bottom;
    svg.setAttribute('viewBox', `0 0 ${PP.w} ${PP.h}`);
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: PP.left, y: PP.top, width: iw, height: ih, fill: '#fdfdfe', stroke: '#dde2e8' }));

    // Symmetric x-range over drawn window
    let xmax = 0;
    for (const s of series) {
      for (let i = 0; i < eAll.length; i++) {
        if (eAll[i] < state.emin || eAll[i] > state.emax) continue;
        xmax = Math.max(xmax, Math.abs(s.y[i]));
      }
    }
    xmax = (xmax || 1) * 1.08;
    const xPix = (v) => PP.left + iw * (0.5 + v / (2 * xmax));
    const yPix = (e) => PP.top + ih * (1 - (e - state.emin) / (state.emax - state.emin));

    // y ticks
    const span = state.emax - state.emin;
    const step = span > 18 ? 4 : span > 8 ? 2 : 1;
    for (let t = Math.ceil(state.emin / step) * step; t <= state.emax; t += step) {
      const y = yPix(t);
      svg.appendChild(svgEl('line', { x1: PP.left, x2: PP.w - PP.right, y1: y, y2: y, stroke: '#eef1f5' }));
      const lbl = svgEl('text', { x: PP.left - 6, y: y + 3.5, 'text-anchor': 'end', class: 'tick-label' });
      lbl.textContent = t;
      svg.appendChild(lbl);
    }
    // zero vertical + Fermi horizontal
    svg.appendChild(svgEl('line', { x1: xPix(0), x2: xPix(0), y1: PP.top, y2: PP.top + ih, stroke: '#c9cfd7' }));
    if (state.emin < 0 && state.emax > 0) {
      svg.appendChild(svgEl('line', { x1: PP.left, x2: PP.left + iw, y1: yPix(0), y2: yPix(0), stroke: '#7a8694', 'stroke-dasharray': '5 4' }));
      const fl = svgEl('text', { x: PP.left + iw - 4, y: yPix(0) - 5, 'text-anchor': 'end', class: 'tick-label' });
      fl.textContent = 'E_F';
      svg.appendChild(fl);
    }

    const clipId = `clip-${svg.dataset.id ?? Math.random().toString(36).slice(2)}`;
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('rect', { x: PP.left, y: PP.top, width: iw, height: ih }));
    svg.appendChild(clip);
    const g = svgEl('g', { 'clip-path': `url(#${clipId})` });
    svg.appendChild(g);

    for (const s of series) {
      let d = '';
      for (let i = 0; i < eAll.length; i++) {
        d += `${d ? 'L' : 'M'}${xPix(s.y[i]).toFixed(1)},${yPix(eAll[i]).toFixed(1)}`;
      }
      const attrs = { d, fill: 'none', stroke: s.color, 'stroke-width': s.width };
      if (s.dash) attrs['stroke-dasharray'] = s.dash;
      g.appendChild(svgEl('path', attrs));
    }

    const xl = svgEl('text', { x: PP.left + iw / 2, y: PP.h - 9, 'text-anchor': 'middle', class: 'tick-label' });
    xl.textContent = axisLabel;
    svg.appendChild(xl);
    const yl = svgEl('text', { x: 12, y: PP.top + ih / 2, class: 'axis-label', transform: `rotate(-90 12 ${PP.top + ih / 2})`, 'text-anchor': 'middle' });
    yl.textContent = 'E − E_F (eV)';
    svg.appendChild(yl);

    // direct series labels
    series.slice(0, 8).forEach((s, i) => {
      const t = svgEl('text', { x: PP.left + 6, y: PP.top + 15 + i * 15, class: 'series-label', fill: s.color });
      t.textContent = s.label;
      svg.appendChild(t);
    });
  }

  function renderPlots() {
    drawPanel(el('plot'), P, seriesList(false), MODES[state.mode].axis);
    if (state.showIntegrated) {
      const label = MODES[state.mode].negate ? '−IpCOHP (eV)' : `I${state.mode.toUpperCase()}`;
      drawPanel(el('int-plot'), PI, seriesList(true), label);
    }
  }

  // ---- Extras card ----
  function renderExtras() {
    const parts = [];
    if (extras.charge) {
      const rows = [...extras.charge.matchAll(/^\s*(\d+)\s+([A-Za-z]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$/gm)]
        .map((m) => `<tr><td>${m[2]}${m[1]}</td><td>${m[3]}</td><td>${m[4]}</td></tr>`);
      parts.push(`<div><h5>CHARGE.lobster</h5><table class="kv-mini"><tr><th></th><th>Mulliken</th><th>Loewdin</th></tr>${rows.join('')}</table></div>`);
    }
    if (extras.madelung) {
      const m = extras.madelung.match(/(-?[\d.]+)\s+(-?[\d.]+)\s*$/m);
      if (m) parts.push(`<div><h5>Madelung energy</h5><p class="ctl-note">Mulliken: ${m[1]} eV<br>Loewdin: ${m[2]} eV (per cell)</p></div>`);
    }
    if (extras.polarization) {
      const rows = [...extras.polarization.matchAll(/^\s*(x|y|z|abs)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$/gm)]
        .map((m) => `<tr><td>${m[1]}</td><td>${m[2]}</td><td>${m[3]}</td></tr>`);
      parts.push(`<div><h5>Polarization (μC/cm²)</h5><table class="kv-mini"><tr><th></th><th>Mulliken</th><th>Loewdin</th></tr>${rows.join('')}</table></div>`);
    }
    el('extras').innerHTML = parts.join('') || '<p class="ctl-note">No summary files found.</p>';
  }

  // ---- Projection quality (lobsterout) ----
  function renderQuality() {
    if (!extras.lobsterout) return;
    const txt = extras.lobsterout;
    el('quality-details').hidden = false;

    const spillM = txt.match(/abs\.?\s*charge spilling:\s*([\d.]+)\s*%/i);
    const recM = txt.match(/electrons recovered by projection:\s*([\d.]+)\s*of\s*([\d.]+)/i);
    const warnings = [];
    txt.split(/\r?\n/).forEach((l) => { if (/^WARNING:/i.test(l.trim())) warnings.push(l.trim().replace(/^WARNING:\s*/i, '')); });

    const flags = [];
    if (spillM) {
      const v = parseFloat(spillM[1]);
      flags.push(flag(`Abs. charge spilling: ${v}%`, v <= 2 ? 'good' : v <= 5 ? 'warn' : 'bad',
        'Fraction of the plane-wave density not representable in the local basis. ≤2% good, 2–5% caution, >5% poor.'));
    }
    if (recM) {
      const got = parseFloat(recM[1]);
      const tot = parseFloat(recM[2]);
      const pct = (100 * got) / tot;
      flags.push(flag(`Electrons recovered: ${got} / ${tot} (${pct.toFixed(2)}%)`,
        pct >= 99.5 ? 'good' : pct >= 98 ? 'warn' : 'bad',
        'Electron count recovered by the projection. ≥99.5% good, ≥98% caution, below that poor.'));
    }
    if (warnings.length) {
      flags.push(flag(`${warnings.length} warning line${warnings.length > 1 ? 's' : ''} in lobsterout`, 'warn', 'See below.'));
    }

    const worst = flags.some((f) => f.includes('qflag bad')) ? 'bad' : flags.some((f) => f.includes('qflag warn')) ? 'warn' : 'good';
    el('qsum').innerHTML = `<span class="qdot ${worst}"></span>`;

    el('quality').innerHTML = `
      <div class="qflags">${flags.join('')}</div>
      ${warnings.length ? `<div class="qwarnings"><h5>LOBSTER warnings</h5><ul>${warnings.map((w) => `<li>${w}</li>`).join('')}</ul></div>` : ''}
      <details class="raw-details"><summary>Full lobsterout</summary><pre class="raw-pre">${txt.replace(/</g, '&lt;')}</pre></details>`;
  }

  renderTable();
  renderPlots();
  renderExtras();
  renderQuality();
}

/** Colored quality chip with tooltip. */
function flag(text, level, tip) {
  return `<span class="qflag ${level}" title="${tip}">${text}</span>`;
}

/** Parse COHPCAR/COOPCAR/COBICAR: labeled columns, each with (p, integrated) pairs. */
function parseCar(text) {
  const lines = text.split(/\r?\n/);
  const nCols = parseInt(lines[1].trim().split(/\s+/)[0], 10); // includes "Average"
  const labels = [];
  let li = 2;
  for (let i = 0; i < nCols; i++, li++) labels.push(lines[li].trim());
  const energies = [];
  const cols = Array.from({ length: nCols }, () => ({ p: [], ip: [] }));
  for (; li < lines.length; li++) {
    const t = lines[li].trim();
    if (!t) continue;
    const v = t.split(/\s+/).map(Number);
    if (v.length < 1 + 2 * nCols || v.some(Number.isNaN)) continue;
    energies.push(v[0]);
    for (let c = 0; c < nCols; c++) {
      cols[c].p.push(v[1 + 2 * c]);
      cols[c].ip.push(v[2 + 2 * c]);
    }
  }
  return { labels, energies: Float64Array.from(energies), cols };
}

/** Parse ICOHPLIST/ICOOPLIST/ICOBILIST rows. */
function parseIlist(text) {
  return text.split(/\r?\n/).slice(2).filter((l) => l.trim()).map((l) => {
    const t = l.trim().split(/\s+/);
    return {
      a: t[1], b: t[2],
      dist: parseFloat(t[3]),
      translation: [+t[4], +t[5], +t[6]],
      value: parseFloat(t[7]),
    };
  });
}
