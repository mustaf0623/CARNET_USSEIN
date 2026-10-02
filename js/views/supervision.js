// Vue de supervision multi-Sections, réservée au super-administrateur.
import { AppState } from '../state.js';
import { escapeHtml, isNetworkError } from '../config.js';
import { idbGet, idbSet } from '../db/indexeddb.js';

const PAGE_SIZE = 1000;
const SUPERVISION_CACHE_KEY = 'carnet-supervision-data';
const COLORS = ['#3D765B', '#B45A3C', '#A9791E', '#42658A', '#8B5F83', '#63705A', '#C0782D', '#4D8584'];
let charts = [];

async function fetchAll(table, columns, sectionIds) {
  if (!sectionIds.length) return [];
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await AppState.sb.from(table).select(columns)
      .in('section_id', sectionIds).order('id').range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function readSupervisionCache() {
  try { return await idbGet(SUPERVISION_CACHE_KEY); } catch (error) { return null; }
}

function applySupervisionCache(cache) {
  if (!cache?.data) return false;
  AppState.supervisionData = cache.data;
  AppState.supervisionCacheInfo = { source: 'cache', fetchedAt: cache.fetchedAt, sectionIds: cache.sectionIds || [] };
  return true;
}

async function loadData() {
  AppState.supervisionLoading = true;
  AppState.supervisionError = '';
  AppState.render();
  try {
    if (!navigator.onLine) {
      if (!applySupervisionCache(await readSupervisionCache())) {
        AppState.supervisionError = 'Hors ligne et aucune copie de Supervision n’est encore enregistrée sur cet appareil. Ouvrez cet onglet une première fois avec une connexion.';
      }
      return;
    }
    const sectionIds = AppState.sbSections.map(section => section.id);
    const [programmes, membres, sessions, pointages, documents, observations] = await Promise.all([
      fetchAll('programmes', 'id, section_id', sectionIds),
      fetchAll('membres', 'id, section_id, ap, sortant_since', sectionIds),
      fetchAll('sessions', 'id, section_id, date', sectionIds),
      fetchAll('pointages', 'id, section_id, session_id, statut', sectionIds),
      fetchAll('amphi_documents', 'id, section_id, created_at', sectionIds),
      fetchAll('observations', 'id, section_id, created_at', sectionIds),
    ]);
    AppState.supervisionData = { programmes, membres, sessions, pointages, documents, observations };
    AppState.supervisionCacheInfo = { source: 'network', fetchedAt: new Date().toISOString(), sectionIds };
    try {
      await idbSet(SUPERVISION_CACHE_KEY, { data: AppState.supervisionData, fetchedAt: AppState.supervisionCacheInfo.fetchedAt, sectionIds });
    } catch (error) { /* l’écran reste utilisable si le stockage local est indisponible */ }
  } catch (error) {
    if (!navigator.onLine || isNetworkError(error)) {
      if (!applySupervisionCache(await readSupervisionCache())) {
        AppState.supervisionError = 'Connexion indisponible et aucune copie locale de Supervision n’est disponible. Connectez-vous une fois pour la créer.';
      }
    } else {
      AppState.supervisionError = error?.message || 'Impossible de charger les données des Sections.';
    }
  } finally {
    AppState.supervisionLoading = false;
    AppState.render();
  }
}

function monthIndex(value) {
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

function monthKey(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthName(key) {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

function weekStart(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function weekIndex(week) { return Math.floor(Date.parse(`${week}T00:00:00Z`) / 604800000); }

function weekLabel(week) {
  return new Date(`${week}T00:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function periodStart(period) {
  if (period === 'all') return '';
  if (period === 'year') return `${new Date().getFullYear()}-01-01`;
  const firstMonth = monthIndex(new Date().toISOString().slice(0, 7)) - 11;
  return `${monthKey(firstMonth)}-01`;
}

function wilsonInterval(successes, total) {
  if (!total) return null;
  const z = 1.96;
  const rate = successes / total;
  const denominator = 1 + z * z / total;
  const center = (rate + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + z * z / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin) * 100, Math.min(1, center + margin) * 100];
}

function collectStats(data, period, selectedSection) {
  const start = periodStart(period);
  const sectionIds = selectedSection === 'all' ? null : new Set([selectedSection]);
  const includesSection = sectionId => !sectionIds || sectionIds.has(sectionId);
  const members = data.membres.filter(row => includesSection(row.section_id));
  const programmes = data.programmes.filter(row => includesSection(row.section_id));
  const documents = data.documents.filter(row => includesSection(row.section_id) && (!start || row.created_at.slice(0, 10) >= start));
  const observations = data.observations.filter(row => includesSection(row.section_id) && (!start || row.created_at.slice(0, 10) >= start));
  const sessions = data.sessions.filter(row => includesSection(row.section_id) && (!start || row.date >= start));
  const sections = AppState.sbSections.filter(section => includesSection(section.id)).map(section => ({
    section,
    members: members.filter(row => row.section_id === section.id && !row.ap && !row.sortant_since).length,
    programmes: programmes.filter(row => row.section_id === section.id).length,
    documents: documents.filter(row => row.section_id === section.id).length,
    observations: observations.filter(row => row.section_id === section.id).length,
    sessions: sessions.filter(row => row.section_id === section.id),
    present: 0,
    total: 0,
    monthly: new Map(),
  }));
  const byId = new Map(sections.map(row => [row.section.id, row]));
  const bySessionId = new Map();

  sessions.forEach(session => {
    const key = session.date.slice(0, 7);
    const target = byId.get(session.section_id);
    if (target && !target.monthly.has(key)) target.monthly.set(key, { present: 0, total: 0, sessions: 0 });
    if (target) target.monthly.get(key).sessions++;
    bySessionId.set(session.id, { session, present: 0, total: 0 });
  });
  data.pointages.forEach(pointage => {
    const sessionStats = bySessionId.get(pointage.session_id);
    const session = sessionStats?.session;
    const target = session && byId.get(session.section_id);
    if (!target) return;
    const key = session.date.slice(0, 7);
    const month = target.monthly.get(key);
    target.total++;
    month.total++;
    sessionStats.total++;
    if (pointage.statut === 'present') {
      target.present++;
      month.present++;
      sessionStats.present++;
    }
  });

  const monthly = new Map();
  const weekly = new Map();
  sections.forEach(row => row.monthly.forEach((value, key) => {
    if (!monthly.has(key)) monthly.set(key, { present: 0, total: 0, sessions: 0 });
    const total = monthly.get(key);
    total.present += value.present;
    total.total += value.total;
    total.sessions += value.sessions;
  }));
  bySessionId.forEach(({ session, present, total }) => {
    if (!total) return;
    const key = weekStart(session.date);
    if (!weekly.has(key)) weekly.set(key, { present: 0, total: 0, sessions: 0, lastDate: session.date });
    const week = weekly.get(key);
    week.present += present;
    week.total += total;
    week.sessions++;
    if (session.date > week.lastDate) week.lastDate = session.date;
  });
  return { sections, monthly, weekly };
}

function fitTrend(points) {
  if (points.length < 6) return null;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const weights = points.map(point => point.total);
  const sumWeight = weights.reduce((sum, value) => sum + value, 0);
  const meanX = xs.reduce((sum, value, index) => sum + value * weights[index], 0) / sumWeight;
  const meanY = ys.reduce((sum, value, index) => sum + value * weights[index], 0) / sumWeight;
  const sxx = xs.reduce((sum, value, index) => sum + weights[index] * (value - meanX) ** 2, 0);
  if (!sxx) return null;
  const slope = xs.reduce((sum, value, index) => sum + weights[index] * (value - meanX) * (ys[index] - meanY), 0) / sxx;
  const intercept = meanY - slope * meanX;
  const residuals = ys.map((value, index) => value - (intercept + slope * xs[index]));
  const variance = residuals.reduce((sum, value, index) => sum + weights[index] * value * value, 0) / Math.max(1, points.length - 2);
  const averageWeight = sumWeight / weights.length;
  return { meanX, intercept, slope, variance, count: points.length, sxx, sumWeight, averageWeight };
}

function studentCritical95(degreesOfFreedom) {
  const criticalValues = [0, 0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  return criticalValues[degreesOfFreedom] || 1.96;
}

function prediction(fit, x) {
  const estimate = fit.intercept + fit.slope * x;
  const margin = studentCritical95(fit.count - 2) * Math.sqrt(fit.variance * (1 / fit.averageWeight + 1 / fit.sumWeight + ((x - fit.meanX) ** 2 / fit.sxx)));
  return { estimate: Math.max(0, Math.min(100, estimate)), low: Math.max(0, estimate - margin), high: Math.min(100, estimate + margin) };
}

function renderLoading() {
  return `<div class="page-head"><div><div class="eyebrow">Pilotage multi-Sections</div><h1 class="page-title">Supervision</h1></div></div><div class="supervision-message" role="status">Chargement des données de toutes les Sections…</div>`;
}

function renderError() {
  return `<div class="page-head"><div><div class="eyebrow">Pilotage multi-Sections</div><h1 class="page-title">Supervision</h1></div></div>
    <div class="supervision-message supervision-error" role="alert"><strong>Les données globales n’ont pas pu être chargées.</strong><span>${escapeHtml(AppState.supervisionError)}</span><button class="btn btn-primary" id="supervisionRetry">Réessayer</button></div>`;
}

export function renderSupervision() {
  if (AppState.supervisionLoading) return renderLoading();
  if (AppState.supervisionError) return renderError();
  if (!AppState.supervisionData) return renderLoading();

  const period = AppState.supervisionPeriod || '12m';
  const selectedSection = AppState.supervisionSection || 'all';
  const { sections, monthly } = collectStats(AppState.supervisionData, period, selectedSection);
  const cacheInfo = AppState.supervisionCacheInfo;
  const cachedSectionCount = new Set(cacheInfo?.sectionIds || []).size;
  const coverageNotice = (!navigator.onLine || cacheInfo?.source === 'cache')
    ? `<div class="supervision-cache-notice" role="status">Hors ligne · copie enregistrée le ${cacheInfo?.fetchedAt ? new Date(cacheInfo.fetchedAt).toLocaleString('fr-FR') : 'date inconnue'} · ${cachedSectionCount} Section${cachedSectionCount === 1 ? '' : 's'} incluse${cachedSectionCount === 1 ? '' : 's'} lors du dernier chargement. Ces données peuvent être anciennes.</div>`
    : '';
  const totalMembers = sections.reduce((sum, row) => sum + row.members, 0);
  const totalSessions = sections.reduce((sum, row) => sum + row.sessions.length, 0);
  const present = sections.reduce((sum, row) => sum + row.present, 0);
  const total = sections.reduce((sum, row) => sum + row.total, 0);
  const rate = total ? Math.round(present / total * 100) : null;
  const interval = wilsonInterval(present, total);
  const ordered = [...sections].sort((a, b) => (b.total ? b.present / b.total : -1) - (a.total ? a.present / a.total : -1));
  const sectionOptions = `<option value="all">Toutes les Sections</option>${AppState.sbSections.map(section => `<option value="${section.id}" ${selectedSection === section.id ? 'selected' : ''}>${escapeHtml(section.nom)}</option>`).join('')}`;
  const periodOptions = `<option value="12m" ${period === '12m' ? 'selected' : ''}>12 derniers mois</option><option value="year" ${period === 'year' ? 'selected' : ''}>Année en cours</option><option value="all" ${period === 'all' ? 'selected' : ''}>Depuis le début</option>`;
  const rows = ordered.map(row => {
    const rowRate = row.total ? Math.round(row.present / row.total * 100) : null;
    const rowInterval = wilsonInterval(row.present, row.total);
    const lastSession = row.sessions.map(session => session.date).sort().at(-1) || '';
    return `<tr><td><button class="supervision-section-link" data-section-id="${row.section.id}">${escapeHtml(row.section.nom)}</button></td><td>${row.members}</td><td>${row.programmes}</td><td>${row.sessions.length}</td><td>${rowRate === null ? '—' : rowRate + '%'}</td><td>${rowInterval ? Math.round(rowInterval[0]) + '–' + Math.round(rowInterval[1]) + '%' : '—'}</td><td>${row.documents}</td><td>${row.observations}</td><td>${lastSession ? new Date(lastSession + 'T00:00:00').toLocaleDateString('fr-FR') : '—'}</td></tr>`;
  }).join('');

  return `${coverageNotice}<div class="page-head supervision-head"><div><div class="eyebrow">Pilotage multi-Sections</div><h1 class="page-title">Supervision</h1><p class="page-sub">Comparer l’activité et les tendances de présence.</p></div>
      <div class="supervision-filters"><label class="field"><span>Période</span><select id="supervisionPeriod">${periodOptions}</select></label><label class="field"><span>Section</span><select id="supervisionSection">${sectionOptions}</select></label><button class="btn btn-ghost supervision-refresh" id="supervisionRefresh" title="Actualiser les données" aria-label="Actualiser les données">↻</button></div></div>
    <section class="supervision-kpis" aria-label="Indicateurs globaux">
      <article class="supervision-kpi"><span class="supervision-kpi-label">Sections suivies</span><strong>${sections.length}</strong><small>${selectedSection === 'all' ? 'ensemble du réseau' : 'Section sélectionnée'}</small></article>
      <article class="supervision-kpi"><span class="supervision-kpi-label">Membres actifs</span><strong>${totalMembers.toLocaleString('fr-FR')}</strong><small>hors sortants et ponctuels</small></article>
      <article class="supervision-kpi"><span class="supervision-kpi-label">Séances enregistrées</span><strong>${totalSessions.toLocaleString('fr-FR')}</strong><small>sur la période</small></article>
      <article class="supervision-kpi supervision-kpi-rate"><span class="supervision-kpi-label">Présence observée</span><strong>${rate === null ? '—' : rate + '%'}</strong><small>${interval ? 'IC 95 % : ' + Math.round(interval[0]) + '–' + Math.round(interval[1]) + '%' : 'Aucun pointage sur cette période'}</small></article>
    </section>
    <section class="supervision-chart-grid">
      <article class="supervision-panel supervision-trend-panel"><div class="supervision-panel-head"><div><h2>Évolution mensuelle</h2><p>Taux calculé sur les pointages enregistrés chaque mois.</p></div><span class="supervision-unit">% présence</span></div><div class="supervision-chart"><canvas id="supervisionTrend" aria-label="Courbe mensuelle de présence"></canvas></div></article>
      <article class="supervision-panel"><div class="supervision-panel-head"><div><h2>Tendance globale</h2><p>Projection courte sur les deux prochaines semaines.</p></div></div><div class="supervision-chart supervision-forecast-chart"><canvas id="supervisionForecast" aria-label="Projection de tendance et intervalle de prédiction"></canvas></div><p class="supervision-method" id="supervisionMethod"></p></article>
    </section>
    <section class="supervision-panel supervision-table-panel"><div class="supervision-panel-head"><div><h2>Comparaison des Sections</h2><p>Taux de présence pondéré par le nombre de pointages; l’intervalle tient compte de leur volume.</p></div><span class="supervision-count">${sections.length} Sections</span></div><div class="supervision-table-scroll"><table class="supervision-table"><thead><tr><th>Section</th><th>Membres actifs</th><th>Programmes</th><th>Séances</th><th>Présence</th><th>IC 95 %</th><th>Dépôts Amphi</th><th>Observations</th><th>Dernière séance</th></tr></thead><tbody>${rows || '<tr><td colspan="9">Aucune Section disponible.</td></tr>'}</tbody></table></div><p class="supervision-footnote">Un intervalle large indique que le taux repose sur peu de pointages. Il décrit l’incertitude statistique, pas la qualité du suivi.</p></section>`;
}

function buildCharts() {
  charts.forEach(chart => chart.destroy());
  charts = [];
  if (!window.Chart || !AppState.supervisionData) return;
  const { sections, monthly, weekly } = collectStats(AppState.supervisionData, AppState.supervisionPeriod || '12m', AppState.supervisionSection || 'all');
  const trendCanvas = document.getElementById('supervisionTrend');
  const keys = [...monthly.keys()].sort();
  if (trendCanvas) {
    const datasets = sections.map((row, index) => ({
      label: row.section.nom,
      data: keys.map(key => {
        const value = row.monthly.get(key);
        return value && value.total ? Math.round(value.present / value.total * 100) : null;
      }),
      borderColor: COLORS[index % COLORS.length],
      backgroundColor: COLORS[index % COLORS.length],
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.25,
      spanGaps: false,
    }));
    charts.push(new Chart(trendCanvas, {
      type: 'line',
      data: { labels: keys.map(monthName), datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, color: '#4A5578', font: { family: 'Manrope', size: 11 } } }, tooltip: { callbacks: { label: context => `${context.dataset.label} : ${context.parsed.y}%` } } }, scales: { y: { min: 0, max: 100, ticks: { callback: value => value + '%', color: '#8A8F72' }, grid: { color: 'rgba(28,37,65,0.08)' } }, x: { ticks: { color: '#4A5578', maxRotation: 0, autoSkip: true }, grid: { display: false } } } },
    }));
  }

  const forecastCanvas = document.getElementById('supervisionForecast');
  const method = document.getElementById('supervisionMethod');
  if (!forecastCanvas) return;
  const history = [...weekly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({
    key,
    x: weekIndex(key),
    y: value.present / value.total * 100,
    sessions: value.sessions,
    total: value.total,
    lastDate: value.lastDate,
  })).slice(-12);
  const recentWeeks = history.slice(-6);
  const recentSessionCount = recentWeeks.reduce((sum, point) => sum + point.sessions, 0);
  const consecutiveWeeks = recentWeeks.length === 6 && recentWeeks.every((point, index) => index === 0 || point.x === recentWeeks[index - 1].x + 1);
  const latestDate = recentWeeks.at(-1)?.lastDate;
  const today = new Date().toISOString().slice(0, 10);
  const daysSinceLatest = latestDate ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latestDate}T00:00:00Z`)) / 86400000 : Infinity;
  if (!consecutiveWeeks || recentSessionCount < 24 || daysSinceLatest < 0 || daysSinceLatest > 14) {
    method.textContent = `Projection masquée : il faut 6 semaines consécutives, 24 séances pointées sur cette période et une dernière séance datant de moins de 15 jours (actuellement ${recentWeeks.length} semaines consécutives, ${recentSessionCount} séances).`;
    return;
  }
  const fit = fitTrend(history);
  if (!fit) {
    method.textContent = 'Projection indisponible : les semaines observées ne permettent pas d’estimer une tendance.';
    return;
  }
  const first = history[0].x;
  const last = history[history.length - 1].x;
  const chartIndexes = Array.from({ length: Math.max(1, last - first + 3) }, (_, index) => first + index);
  const labels = chartIndexes.map(index => weekLabel(new Date(index * 604800000).toISOString().slice(0, 10)));
  const observedByWeek = new Map(history.map(point => [point.x, point.y]));
  const observed = chartIndexes.map(index => observedByWeek.get(index) ?? null);
  const projected = chartIndexes.map(index => index > last ? prediction(fit, index).estimate : null);
  const lower = chartIndexes.map(index => index > last ? prediction(fit, index).low : null);
  const upper = chartIndexes.map(index => index > last ? prediction(fit, index).high : null);
  charts.push(new Chart(forecastCanvas, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Observé', data: observed, borderColor: '#1C2541', backgroundColor: '#1C2541', borderWidth: 2, pointRadius: 2, tension: 0.2 },
      { label: 'Limite basse', data: lower, borderColor: 'transparent', pointRadius: 0, fill: false },
      { label: 'Limite haute (95 %)', data: upper, borderColor: 'transparent', backgroundColor: 'rgba(79,107,77,0.17)', pointRadius: 0, fill: '-1' },
      { label: 'Projection', data: projected, borderColor: '#4F6B4D', backgroundColor: '#4F6B4D', borderDash: [5, 4], borderWidth: 2, pointRadius: 3, tension: 0.2 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, color: '#4A5578', font: { family: 'Manrope', size: 10 } } }, tooltip: { callbacks: { label: context => context.parsed.y == null ? '' : `${context.dataset.label} : ${Math.round(context.parsed.y)}%` } } }, scales: { y: { min: 0, max: 100, ticks: { callback: value => value + '%', color: '#8A8F72' }, grid: { color: 'rgba(28,37,65,0.08)' } }, x: { ticks: { color: '#4A5578', maxRotation: 0, autoSkip: true }, grid: { display: false } } } },
  }));
  method.textContent = 'Régression hebdomadaire pondérée par le nombre de pointages; fenêtre récente exigée. Intervalle de prédiction à 95 % selon Student, sous hypothèses de semaines indépendantes et comparables. Tendance indicative, non causale.';
}

export function attachSupervisionEvents() {
  if (!AppState.supervisionData && !AppState.supervisionLoading && !AppState.supervisionError) {
    loadData();
    return;
  }
  const period = document.getElementById('supervisionPeriod');
  if (period) period.addEventListener('change', event => { AppState.supervisionPeriod = event.target.value; AppState.render(); });
  const section = document.getElementById('supervisionSection');
  if (section) section.addEventListener('change', event => { AppState.supervisionSection = event.target.value; AppState.render(); });
  const refresh = document.getElementById('supervisionRefresh');
  if (refresh) refresh.addEventListener('click', loadData);
  const retry = document.getElementById('supervisionRetry');
  if (retry) retry.addEventListener('click', loadData);
  document.querySelectorAll('.supervision-section-link').forEach(button => button.addEventListener('click', () => {
    AppState.supervisionSection = button.dataset.sectionId;
    AppState.render();
  }));
  buildCharts();
}