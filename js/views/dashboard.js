// views/dashboard.js — Onglet Tableau de bord : cartes de synthèse et graphiques Chart.js.
import { AppState } from '../state.js';
import { escapeHtml, ICONS } from '../config.js';
import { scopedStats, programStats, sessionStats, getAvailableYears, periodMatches } from '../domain/stats.js';
import { statCard, emptyRow } from '../components/ui.js';

export function renderDashboard() {
  const d = AppState.data;
  if (!d.membres.length) return renderEmpty();
  const filter = AppState.dashProgFilter;
  const yearFilter = AppState.dashYearFilter;
  const g = scopedStats(d, filter, yearFilter);
  const years = getAvailableYears(d);
  const progOptions = [`<option value="global">Tous les programmes</option>`].concat(
    d.programmes.map(p => `<option value="${p.id}" ${filter === p.id ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`)
  ).join('');
  const yearOptions = [`<option value="toutes" ${yearFilter === 'toutes' ? 'selected' : ''}>Toutes années</option>`].concat(
    years.map(y => `<option value="${y}" ${yearFilter === y ? 'selected' : ''}>${y}</option>`)
  ).join('');

  const breakdownBlock = filter === 'global'
    ? `<div class="card">
        <h3 class="card-title">Présence par programme</h3>
        <div class="card-sub"><span class="legend-dot" style="background:var(--emerald)"></span>Présence
          <span class="legend-dot" style="background:var(--terracotta);margin-left:12px"></span>Absence</div>
        <div class="ledger">
          ${d.programmes.map(p => { const s = programStats(d, p.id, yearFilter); return `<div class="ledger-row">
              <div class="prog-name">${escapeHtml(p.nom)}</div>
              <div class="prog-bar-wrap"><div class="prog-bar-fill" style="width:${s.tauxPresence}%"></div></div>
              <div class="prog-pct">${s.tauxPresence}%</div>
            </div>`; }).join('') || emptyRow('Aucun programme.')}
        </div>
      </div>`
    : `<div class="card">
        <h3 class="card-title">Détail par séance</h3>
        <div class="card-sub">Taux de présence séance par séance, pour ce programme${yearFilter !== 'toutes' ? ' — ' + yearFilter : ''}</div>
        <div class="ledger">
          ${d.sessions.filter(s => s.programmeId === filter && periodMatches(s.date, yearFilter)).sort((a,b)=>b.date.localeCompare(a.date)).map(s => {
            const ss = sessionStats(d, s.id);
            return `<div class="ledger-row">
              <div class="prog-name">${escapeHtml(s.label)}</div>
              <div class="prog-bar-wrap"><div class="prog-bar-fill" style="width:${ss.tauxPresence}%"></div></div>
              <div class="prog-pct">${ss.tauxPresence}%</div>
            </div>`;
          }).join('') || emptyRow('Aucune séance enregistrée pour cette période.')}
        </div>
      </div>`;

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Vue d’ensemble</div>
        <h1 class="page-title">Tableau de bord</h1>
        <p class="page-sub">Comportement des données de présence — filtrable par programme et par année.</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div class="field">
          <label>Année</label>
          <select id="dashYearFilter">${yearOptions}</select>
        </div>
        <div class="field">
          <label>Programme</label>
          <select id="dashFilter">${progOptions}</select>
        </div>
      </div>
    </div>
    <div class="grid grid-4" style="margin-bottom:18px;">
      ${statCard('Membres', g.total, filter === 'global' ? 'inscrits au total' : 'inscrits à ce programme', 'stat-emerald')}
      ${statCard('Hommes / Femmes', g.nbH + ' / ' + g.nbF, Math.round((g.nbF/(g.total||1))*100) + '% de femmes', 'stat-gold')}
      ${statCard('Taux de présence', g.tauxPresence + '%', yearFilter === 'toutes' ? 'toutes séances confondues' : 'séances de ' + yearFilter, 'stat-emerald')}
      ${statCard('Taux d’absence', g.tauxAbsence + '%', yearFilter === 'toutes' ? 'toutes séances confondues' : 'séances de ' + yearFilter, 'stat-terracotta')}
    </div>
    <div class="grid grid-2">
      ${breakdownBlock}
      <div class="card">
        <h3 class="card-title">Répartition Hommes / Femmes</h3>
        <div class="card-sub">${filter === 'global' ? 'Sur l’ensemble des membres' : 'Sur les membres de ce programme'}</div>
        <canvas id="hfChart" height="200"></canvas>
      </div>
    </div>
    ${filter === 'global' ? `<div class="card" style="margin-top:16px;">
      <h3 class="card-title">Taux de participation par programme</h3>
      <div class="card-sub">Part des membres inscrits ayant été présents au moins une fois${yearFilter !== 'toutes' ? ' en ' + yearFilter : ''}</div>
      <canvas id="partChart" height="120"></canvas>
    </div>` : `<div class="card" style="margin-top:16px;">
      <h3 class="card-title">Taux de participation</h3>
      <div class="card-sub">Part des membres inscrits à ce programme ayant été présents au moins une fois${yearFilter !== 'toutes' ? ' en ' + yearFilter : ''}</div>
      <div class="ledger"><div class="ledger-row">
        <div class="prog-name">${escapeHtml((d.programmes.find(p=>p.id===filter)||{}).nom||'')}</div>
        <div class="prog-bar-wrap"><div class="prog-bar-fill" style="width:${programStats(d, filter, yearFilter).tauxParticipation}%"></div></div>
        <div class="prog-pct">${programStats(d, filter, yearFilter).tauxParticipation}%</div>
      </div></div>
    </div>`}
    <div class="card" style="margin-top:16px;">
      <h3 class="card-title">Tendance de présence</h3>
      <div class="card-sub">Taux de présence sur les dernières séances, dans l’ordre chronologique</div>
      <canvas id="trendChart" height="110"></canvas>
    </div>
  `;
}

export function renderEmpty() {
  return `<div class="page-head"><div><div class="eyebrow">Vue d’ensemble</div><h1 class="page-title">Tableau de bord</h1></div></div>
  <div class="card empty-state">${ICONS.membres}<h3 style="color:var(--ink);margin:0 0 6px;">Aucune donnée pour l’instant</h3><p style="margin:0 0 18px;">Ajoutez des membres ou importez un fichier Excel pour voir vos statistiques.</p>
  <button class="btn btn-primary" id="emptyGoMembres">${ICONS.plus} Ajouter des membres</button></div>`;
}

const centerTextPlugin = {
  id: 'centerText',
  afterDraw(chart) {
    if (chart.config.type !== 'doughnut' || !chart.config._centerText) return;
    const { ctx, chartArea: { left, right, top, bottom } } = chart;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = "700 26px 'Fraunces', serif";
    ctx.fillStyle = '#1C2541';
    ctx.fillText(chart.config._centerText.value, cx, cy - 6);
    ctx.font = "600 10px 'Manrope', sans-serif";
    ctx.fillStyle = '#8A8F72';
    ctx.fillText(chart.config._centerText.label, cx, cy + 14);
    ctx.restore();
  }
};

let hfChartInst = null, partChartInst = null, trendChartInst = null;
export function attachDashboardEvents() {
  const d = AppState.data;
  const filterSel = document.getElementById('dashFilter');
  if (filterSel) filterSel.addEventListener('change', e => { AppState.dashProgFilter = e.target.value; AppState.render(); });
  const yearSel = document.getElementById('dashYearFilter');
  if (yearSel) yearSel.addEventListener('change', e => { AppState.dashYearFilter = e.target.value; AppState.render(); });

  const emptyGo = document.getElementById('emptyGoMembres');
  if (emptyGo) emptyGo.addEventListener('click', () => { AppState.tab = 'membres'; AppState.render(); });

  if (!d.membres.length) return;

  const g = scopedStats(d, AppState.dashProgFilter, AppState.dashYearFilter);
  const hfCanvas = document.getElementById('hfChart');
  if (hfCanvas) {
    if (hfChartInst) hfChartInst.destroy();
    const ctx = hfCanvas.getContext('2d');
    const goldGrad = ctx.createLinearGradient(0, 0, 0, 220);
    goldGrad.addColorStop(0, '#E0AC2E'); goldGrad.addColorStop(1, '#B87A0C');
    const emeraldGrad = ctx.createLinearGradient(0, 0, 0, 220);
    emeraldGrad.addColorStop(0, '#2CC28E'); emeraldGrad.addColorStop(1, '#3D5540');
    hfChartInst = new Chart(hfCanvas, {
      type: 'doughnut',
      data: { labels: ['Hommes', 'Femmes'], datasets: [{ data: [g.nbH, g.nbF], backgroundColor: [goldGrad, emeraldGrad], borderColor: '#FFFFFF', borderWidth: 4, hoverOffset: 14, hoverBorderWidth: 4 }] },
      options: {
        cutout: '70%',
        animation: { animateRotate: true, animateScale: true, duration: 1000, easing: 'easeOutQuart' },
        interaction: { intersect: true },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#1C2541', usePointStyle: true, pointStyle: 'circle', padding: 16, font: { family: 'Manrope', size: 12, weight: 600 } } },
          tooltip: {
            backgroundColor: '#141B33', titleColor: '#EEF2E6', bodyColor: '#EEF2E6',
            padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4,
            callbacks: { label: (ctx) => ' ' + ctx.label + ' : ' + ctx.parsed + (g.total ? ' (' + Math.round(ctx.parsed / g.total * 100) + '%)' : '') }
          }
        }
      },
      plugins: [centerTextPlugin]
    });
    hfChartInst.config._centerText = { value: String(g.total), label: g.total > 1 ? 'membres' : 'membre' };
    hfChartInst.update();
  }
  const partCanvas = document.getElementById('partChart');
  if (partCanvas) {
    if (partChartInst) partChartInst.destroy();
    const ctx2 = partCanvas.getContext('2d');
    const barGrad = ctx2.createLinearGradient(0, 0, 0, 260);
    barGrad.addColorStop(0, '#2CC28E'); barGrad.addColorStop(1, '#3D5540');
    const barHoverGrad = ctx2.createLinearGradient(0, 0, 0, 260);
    barHoverGrad.addColorStop(0, '#3EDBA3'); barHoverGrad.addColorStop(1, '#0E9E68');
    const labels = d.programmes.map(p => p.nom);
    const values = d.programmes.map(p => programStats(d, p.id, AppState.dashYearFilter).tauxParticipation);
    partChartInst = new Chart(partCanvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Participation (%)', data: values, backgroundColor: barGrad, hoverBackgroundColor: barHoverGrad, borderRadius: 8, maxBarThickness: 46 }] },
      options: {
        animation: { duration: 900, easing: 'easeOutQuart', delay: (ctx) => ctx.type === 'data' ? ctx.dataIndex * 90 : 0 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141B33', titleColor: '#EEF2E6', bodyColor: '#EEF2E6',
            padding: 10, cornerRadius: 8,
            callbacks: { label: (ctx) => ' Participation : ' + ctx.parsed.y + '%' }
          }
        },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { color: '#4A5578', callback: (v) => v + '%' }, grid: { color: 'rgba(28,42,32,0.08)' } },
          x: { ticks: { color: '#1C2541', font: { weight: 600 } }, grid: { display: false } }
        }
      },
      plugins: [{
        id: 'barValueLabels',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const val = chart.data.datasets[0].data[i];
            if (val === undefined || val === null) return;
            ctx.save();
            ctx.font = "700 11px 'IBM Plex Mono', monospace";
            ctx.fillStyle = '#3D5540';
            ctx.textAlign = 'center';
            ctx.fillText(val + '%', bar.x, bar.y - 8);
            ctx.restore();
          });
        }
      }]
    });
  }

  const trendCanvas = document.getElementById('trendChart');
  if (trendCanvas) {
    if (trendChartInst) trendChartInst.destroy();
    const scopedSessions = (AppState.dashProgFilter === 'global' ? d.sessions : d.sessions.filter(s => s.programmeId === AppState.dashProgFilter))
      .filter(s => AppState.dashYearFilter === 'toutes' || periodMatches(s.date, AppState.dashYearFilter))
      .slice().sort((a, b) => a.date.localeCompare(b.date))
      .slice(-8);
    const trendLabels = scopedSessions.map(s => formatShortDate(s.date));
    const trendValues = scopedSessions.map(s => sessionStats(d, s.id).tauxPresence);
    const ctx3 = trendCanvas.getContext('2d');
    const trendFill = ctx3.createLinearGradient(0, 0, 0, 110);
    trendFill.addColorStop(0, 'rgba(28,37,65,0.16)'); trendFill.addColorStop(1, 'rgba(28,37,65,0)');
    trendChartInst = new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [{
          data: trendValues,
          borderColor: '#1C2541', borderWidth: 2.2,
          pointRadius: 3.5, pointBackgroundColor: '#1C2541', pointBorderColor: '#FBF8EE', pointBorderWidth: 2,
          tension: 0.35, fill: true, backgroundColor: trendFill,
        }]
      },
      options: {
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141B33', titleColor: '#F1ECDE', bodyColor: '#F1ECDE',
            padding: 10, cornerRadius: 8,
            callbacks: { label: (ctx) => ' Présence : ' + ctx.parsed.y + '%' }
          }
        },
        scales: {
          y: { min: 0, max: 100, ticks: { color: '#8A8F72', callback: v => v + '%', font: { family: 'IBM Plex Mono', size: 10.5 } }, grid: { color: 'rgba(28,37,65,0.08)' } },
          x: { ticks: { color: '#4A5578', font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  }
}

function formatShortDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\s\d{4}$/, '');
}
