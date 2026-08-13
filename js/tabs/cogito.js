// COGITO tab: embeds interactive HTML figures produced by COGITO
// (self-contained Plotly pages) so they stay fully interactable.

export async function initCogitoTab(host, ctx) {
  const cfg = ctx.meta.cogito;
  if (!cfg || !cfg.plots?.length) {
    host.innerHTML = '<div class="tab-panel"><p class="panel-desc">No COGITO outputs configured for this material yet.</p></div>';
    return;
  }

  host.innerHTML = `
    <div class="tab-panel">
      <h3>COGITO</h3>
      <p class="panel-desc">Crystal Orbital Guided Iteration to Atomic Orbitals — chemically adaptive atomic
        orbitals derived from the DFT crystal orbitals. The figures below are COGITO's own interactive outputs,
        embedded live.</p>
      ${cfg.plots.map((p, i) => `
        <div class="cogito-card">
          <div class="card-header cogito-card-header">
            <h2>${p.title}</h2>
            <a class="btn-small" href="materials/${ctx.materialId}/${p.file}" target="_blank" rel="noopener">Open full size ↗</a>
          </div>
          ${p.description ? `<p class="panel-desc cogito-desc">${p.description}</p>` : ''}
          <iframe class="cogito-frame" data-idx="${i}" title="${p.title}" loading="lazy"
                  src="materials/${ctx.materialId}/${p.file}"></iframe>
        </div>`).join('')}
      <details class="wann-matrix-details" data-id="quality-details" hidden>
        <summary>COGITO quality &amp; error output <span data-id="qsum"></span></summary>
        <div class="quality-body" data-id="quality"></div>
      </details>
    </div>`;

  if (cfg.quality) await renderQuality(host, ctx, cfg.quality);
}

async function renderQuality(host, ctx, q) {
  const el = (id) => host.querySelector(`[data-id="${id}"]`);
  const files = {};
  for (const f of q.files ?? []) {
    try {
      const r = await fetch(`materials/${ctx.materialId}/${f}`);
      if (r.ok) files[f.split('/').pop()] = await r.text();
    } catch { /* optional */ }
  }
  const imgUrl = q.image ? `materials/${ctx.materialId}/${q.image}` : null;
  if (!Object.keys(files).length && !imgUrl) return;
  el('quality-details').hidden = false;

  const flags = [];
  const err = files['error_output.txt'] ?? '';
  const metricDefs = [
    [/percent charge spilling:\s*([\d.]+)%/i, 'Charge spilling', [1, 3]],
    [/maximum band charge spill:\s*([\d.]+)%/i, 'Max band charge spill', [2, 5]],
    [/maximum charge spill:\s*([\d.]+)%/i, 'Max charge spill', [2, 5]],
    [/average orbital mixing:\s*([\d.]+)%/i, 'Avg orbital mixing', [1, 3]],
    [/max orbital mixing:\s*([\d.]+)%/i, 'Max orbital mixing', [2, 5]],
  ];
  for (const [re, label, [good, warn]] of metricDefs) {
    const m = err.match(re);
    if (!m) continue;
    const v = parseFloat(m[1]);
    const level = v <= good ? 'good' : v <= warn ? 'warn' : 'bad';
    flags.push(`<span class="qflag ${level}" title="${label} from error_output.txt. ≤${good}% good, ≤${warn}% caution.">${label}: ${v}%</span>`);
  }
  const analysis = files['analysis.txt'] ?? '';
  const warnCount = (analysis.match(/^Warning:/gim) ?? []).length + (analysis.match(/failed/gi) ?? []).length;
  if (warnCount) {
    flags.push(`<span class="qflag warn" title="Warnings/failures reported in analysis.txt — see below.">${warnCount} warning${warnCount > 1 ? 's' : ''} in analysis.txt</span>`);
  }
  if (/within expected range/i.test(analysis)) {
    flags.push(`<span class="qflag good" title="From analysis.txt.">Band spillage &amp; orbital mixing within expected range</span>`);
  }

  const worst = flags.some((f) => f.includes('qflag bad')) ? 'bad' : flags.some((f) => f.includes('qflag warn')) ? 'warn' : 'good';
  el('qsum').innerHTML = `<span class="qdot ${worst}"></span>`;

  const esc = (s) => s.replace(/</g, '&lt;');
  const fileBlocks = Object.entries(files).map(([name, txt]) => `
    <details class="raw-details" ${name === 'analysis.txt' ? 'open' : ''}>
      <summary>${name}</summary>
      <pre class="raw-pre">${esc(txt)}</pre>
    </details>`).join('');

  el('quality').innerHTML = `
    <div class="qflags">${flags.join('')}</div>
    <div class="cogito-quality-grid">
      ${imgUrl ? `<figure class="qfig"><img src="${imgUrl}" alt="COGITO orbital radius changes"><figcaption>${q.image.split('/').pop()} — orbital radius changes from COGITO</figcaption></figure>` : ''}
      <div class="qfiles">${fileBlocks}</div>
    </div>`;
}
