// Vue comparative et répertoire du Tableau de bord Conseil.
import { AppState, showToast } from '../state.js';
import { escapeHtml } from '../config.js';
import { findExtraKey, isSortant } from '../domain/membres.js';
import { wilsonInterval } from '../domain/stats.js';
import { statCard } from '../components/ui.js';
import { getCouncilSummary, loadCouncilRoster, loadSupervisionData } from './supervision.js';

const CHART_COLORS = ['#3D765B', '#B45A3C', '#A9791E', '#42658A', '#8B5F83', '#63705A', '#C0782D', '#4D8584'];
let councilChart = null;

export function canAccessCouncilView() {
  return AppState.sbProfile?.role === 'super_admin';
}

function periodStart(period) {
  if (period === 'all') return '';
  if (period === 'year') return `${new Date().getFullYear()}-01-01`;
  const date = new Date();
  date.setMonth(date.getMonth() - 11, 1);
  return date.toISOString().slice(0, 10);
}

function monthLabel(key) {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

function memberStatus(member) {
  return member.sortantSince || isSortant(member) ? 'sortants' : member.ap ? 'ap' : 'actifs';
}

function extraValue(extra, key) {
  const field = findExtraKey(extra, key);
  return field ? String(extra[field] || '').trim() : '';
}

function selectedSectionName(sectionId) {
  return AppState.sbSections.find(section => section.id === sectionId)?.nom || 'Section';
}

export function renderCouncilToggleButton() {
  return `<button type="button" class="btn btn-ghost btn-sm" id="dashboardCouncilBtn">Conseil</button>`;
}

function renderCouncilLoading() {
  return `<div class="page-head"><div><div class="eyebrow">Vue Conseil</div><h1 class="page-title">Tableau de bord</h1></div><div class="council-head-controls"><button type="button" class="btn btn-ghost btn-sm" id="closeCouncilViewBtn">Fermer</button></div></div>
    <div class="supervision-message" role="status">Chargement des indicateurs multi-Sections…</div>`;
}

function renderCouncilRoster(rows, sectionId) {
  const sectionName = selectedSectionName(sectionId);
  const sectionProgrammes = AppState.supervisionData.programmes.filter(programme => programme.section_id === sectionId);
  const query = (AppState.councilRosterSearch || '').trim().toLocaleLowerCase('fr');
  const statusFilter = AppState.councilRosterType || 'actifs';
  const programmeFilter = AppState.councilRosterProgramme || 'all';
  const filtered = rows.filter(member => {
    if (memberStatus(member) !== statusFilter) return false;
    if (programmeFilter !== 'all' && !member.allProgrammes && !member.programmeIds.includes(programmeFilter)) return false;
    if (!query) return true;
    const values = [member.nom, member.prenom, extraValue(member.extra, 'ufr'), extraValue(member.extra, 'filiere'), extraValue(member.extra, 'niveau')];
    return values.some(value => String(value || '').toLocaleLowerCase('fr').includes(query));
  }).sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr'));
  const statusOptions = [
    ['actifs', 'Permanents'],
    ['ap', 'Ponctuels (AP)'],
    ['sortants', 'Sortants'],
  ].map(([value, label]) => `<option value="${value}" ${statusFilter === value ? 'selected' : ''}>${label}</option>`).join('');
  const programmeOptions = `<option value="all">Tous les programmes</option>${sectionProgrammes.map(programme => `<option value="${escapeHtml(programme.id)}" ${programmeFilter === programme.id ? 'selected' : ''}>${escapeHtml(programme.nom || 'Programme')}</option>`).join('')}`;
  const memberRows = filtered.map(member => {
    const programmes = member.allProgrammes
      ? 'Tous les programmes'
      : member.programmeIds.map(id => sectionProgrammes.find(programme => programme.id === id)?.nom).filter(Boolean).join(', ') || '—';
    const sexe = member.sexe === 'H' ? 'Homme' : member.sexe === 'F' ? 'Femme' : '—';
    const statusLabel = memberStatus(member) === 'ap' ? 'AP' : memberStatus(member) === 'sortants' ? 'Sortant' : 'Permanent';
    return `<tr><td>${escapeHtml(`${member.prenom} ${member.nom}`.trim())}</td><td>${sexe}</td><td>${escapeHtml(extraValue(member.extra, 'ufr') || '—')}</td><td>${escapeHtml(extraValue(member.extra, 'filiere') || '—')}</td><td>${escapeHtml(extraValue(member.extra, 'niveau') || '—')}</td><td>${escapeHtml(programmes)}</td><td>${statusLabel}</td></tr>`;
  }).join('');
  const rosterState = AppState.councilRosterLoading
    ? '<p class="council-roster-message" role="status">Chargement du répertoire…</p>'
    : AppState.councilRosterError
      ? `<p class="council-roster-message council-roster-error" role="alert">${escapeHtml(AppState.councilRosterError)}</p>`
      : `<div class="council-table-scroll"><table class="data-table council-roster-table"><thead><tr><th>Nom</th><th>Sexe</th><th>UFR</th><th>Filière</th><th>Niveau</th><th>Programmes</th><th>Statut</th></tr></thead><tbody>${memberRows || `<tr><td colspan="7">Aucun membre ne correspond à ces filtres.</td></tr>`}</tbody></table></div>`;

  return `<section class="card council-roster" id="councilRoster">
    <div class="council-roster-head"><div><div class="eyebrow">Effectif détaillé</div><h2>${escapeHtml(sectionName)}</h2><p class="card-sub">Répertoire consultable; les champs UFR, filière et niveau proviennent de l’import lorsqu’ils existent.</p></div><button type="button" class="btn btn-ghost btn-sm" id="closeCouncilRoster">Fermer</button></div>
    <div class="council-roster-filters"><label class="field"><span>Statut</span><select id="councilRosterType">${statusOptions}</select></label><label class="field"><span>Programme</span><select id="councilRosterProgramme">${programmeOptions}</select></label><label class="field council-roster-search"><span>Rechercher</span><input id="councilRosterSearch" type="text" placeholder="Nom, UFR, filière…" value="${escapeHtml(AppState.councilRosterSearch || '')}"></label><span class="council-roster-count">${filtered.length} membre${filtered.length === 1 ? '' : 's'}</span></div>
    ${rosterState}
  </section>`;
}

export function renderCouncilDashboard() {
  if (!AppState.supervisionData) return renderCouncilLoading();
  const period = AppState.councilPeriod || '12m';
  const sections = getCouncilSummary(period) || [];
  const totalActive = sections.reduce((sum, row) => sum + row.members, 0);
  const totalAp = sections.reduce((sum, row) => sum + row.apMembers, 0);
  const totalSortants = sections.reduce((sum, row) => sum + row.sortants, 0);
  const present = sections.reduce((sum, row) => sum + row.present, 0);
  const totalPointages = sections.reduce((sum, row) => sum + row.total, 0);
  const totalSessions = sections.reduce((sum, row) => sum + row.sessions.length, 0);
  const globalRate = totalPointages ? Math.round(present / totalPointages * 100) : null;
  const interval = wilsonInterval(present, totalPointages);
  const periodOptions = `<option value="12m" ${period === '12m' ? 'selected' : ''}>12 derniers mois</option><option value="year" ${period === 'year' ? 'selected' : ''}>Année en cours</option><option value="all" ${period === 'all' ? 'selected' : ''}>Depuis le début</option>`;
  const sectionRows = sections.map(row => {
    const attendance = row.attendanceRate === null
      ? '<span class="council-no-data">Aucun pointage</span>'
      : `<strong>${row.attendanceRate}%</strong><span class="council-interval">${row.interval ? `IC 95 % · ${Math.round(row.interval[0])}–${Math.round(row.interval[1])}%` : ''}</span>`;
    return `<tr><td><button type="button" class="council-open-roster" data-section-id="${escapeHtml(row.section.id)}">${escapeHtml(row.section.nom)}<span>Effectif détaillé</span></button></td><td>${row.members.toLocaleString('fr-FR')}</td><td>${AppState.supervisionCacheInfo?.memberBreakdownAvailable === false ? '—' : `${row.men} / ${row.women}`}</td><td>${row.apMembers}</td><td>${row.sortants}</td><td>${row.programmes}</td><td>${row.sessions.length}</td><td>${attendance}</td><td>${row.lastSession ? new Date(row.lastSession + 'T00:00:00').toLocaleDateString('fr-FR') : '—'}</td></tr>`;
  }).join('');
  const detail = AppState.councilRosterSectionId
    ? renderCouncilRoster(AppState.councilRoster || [], AppState.councilRosterSectionId)
    : '';

  return `<div class="page-head council-page-head"><div><div class="eyebrow">Vue Conseil</div><h1 class="page-title">Tableau de bord</h1><p class="page-sub">Effectifs et présence comparés par Section.</p></div><div class="council-head-controls"><button type="button" class="btn btn-ghost btn-sm" id="closeCouncilViewBtn">Fermer</button><label class="field"><span>Période commune</span><select id="councilPeriod">${periodOptions}</select></label></div></div>
    <section class="grid grid-4 council-kpis" aria-label="Synthèse du Conseil">
      ${statCard('Membres actifs', totalActive.toLocaleString('fr-FR'), 'permanents · hors AP et sortants', 'stat-emerald')}
      ${statCard('Ponctuels (AP)', totalAp.toLocaleString('fr-FR'), 'effectif ponctuel du Conseil', 'stat-gold')}
      ${statCard('Sortants', totalSortants.toLocaleString('fr-FR'), 'affichés séparément des actifs', 'stat-terracotta')}
      ${statCard('Présence observée', globalRate === null ? '—' : globalRate + '%', interval ? `IC 95 % : ${Math.round(interval[0])}–${Math.round(interval[1])}% · ${totalPointages.toLocaleString('fr-FR')} pointages` : `${totalSessions} séances · aucun pointage`, 'stat-emerald')}
    </section>
    <section class="grid grid-2 council-analytics">
      <article class="card"><h3 class="card-title">Présence mensuelle</h3><p class="card-sub">Taux agrégé, pondéré par les pointages de toutes les Sections.</p><div class="council-chart"><canvas id="councilTrend" aria-label="Évolution mensuelle de la présence par Section"></canvas></div></article>
      <article class="card"><h3 class="card-title">Comparaison des Sections</h3><p class="card-sub">Les taux doivent être lus avec leur volume de pointages et le nombre de séances.</p><div class="council-table-scroll"><table class="data-table council-summary-table"><thead><tr><th>Section</th><th>Actifs</th><th>H / F</th><th>AP</th><th>Sortants</th><th>Prog.</th><th>Séances</th><th>Présence · IC 95 %</th><th>Dernière séance</th></tr></thead><tbody>${sectionRows || '<tr><td colspan="9">Aucune Section disponible.</td></tr>'}</tbody></table></div></article>
    </section>
    ${detail}`;
}

function buildCouncilChart() {
  if (councilChart) { councilChart.destroy(); councilChart = null; }
  const canvas = document.getElementById('councilTrend');
  const data = AppState.supervisionData;
  if (!canvas || !data || !window.Chart) return;
  const start = periodStart(AppState.councilPeriod || '12m');
  const sessionById = new Map(data.sessions.filter(session => !start || session.date >= start).map(session => [session.id, session]));
  const buckets = new Map();
  data.pointages.forEach(pointage => {
    const session = sessionById.get(pointage.session_id);
    if (!session) return;
    const key = session.date.slice(0, 7);
    const bucketKey = `${session.section_id}\u0000${key}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { sectionId: session.section_id, key, present: 0, total: 0 });
    const bucket = buckets.get(bucketKey);
    bucket.total++;
    if (pointage.statut === 'present') bucket.present++;
  });
  const months = [...new Set([...buckets.values()].map(bucket => bucket.key))].sort();
  const datasets = AppState.sbSections.map((section, index) => ({
    label: section.nom,
    data: months.map(month => {
      const bucket = buckets.get(`${section.id}\u0000${month}`);
      return bucket?.total ? Math.round(bucket.present / bucket.total * 100) : null;
    }),
    borderColor: CHART_COLORS[index % CHART_COLORS.length],
    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
    borderWidth: 2,
    pointRadius: 3,
    tension: 0.25,
    spanGaps: false,
  }));
  councilChart = new Chart(canvas, {
    type: 'line',
    data: { labels: months.map(monthLabel), datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, color: '#4A5578', font: { family: 'Manrope', size: 11 } } }, tooltip: { callbacks: { label: context => `${context.dataset.label} : ${context.parsed.y}%` } } }, scales: { y: { min: 0, max: 100, ticks: { callback: value => value + '%', color: '#8A8F72' }, grid: { color: 'rgba(28,37,65,0.08)' } }, x: { ticks: { color: '#4A5578', maxRotation: 0, autoSkip: true }, grid: { display: false } } } },
  });
}

async function openCouncilRoster(sectionId) {
  AppState.councilRosterSectionId = sectionId;
  AppState.councilRosterLoading = true;
  AppState.councilRosterError = '';
  AppState.councilRosterSearch = '';
  AppState.councilRosterProgramme = 'all';
  AppState.councilRosterType = 'actifs';
  AppState.councilRoster = [];
  AppState.render();
  try {
    AppState.councilRoster = await loadCouncilRoster(sectionId);
  } catch (error) {
    AppState.councilRosterError = error?.message || 'Le répertoire est indisponible.';
  } finally {
    AppState.councilRosterLoading = false;
    AppState.render();
    document.getElementById('councilRoster')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export function attachCouncilDashboardEvents() {
  const closeView = document.getElementById('closeCouncilViewBtn');
  if (closeView) closeView.addEventListener('click', () => {
    AppState.dashboardMode = 'section';
    AppState.councilRosterSectionId = null;
    AppState.render();
  });
  const period = document.getElementById('councilPeriod');
  if (period) period.addEventListener('change', event => { AppState.councilPeriod = event.target.value; AppState.render(); });
  const close = document.getElementById('closeCouncilRoster');
  if (close) close.addEventListener('click', () => {
    AppState.councilRosterSectionId = null;
    AppState.render();
  });
  const rosterType = document.getElementById('councilRosterType');
  if (rosterType) rosterType.addEventListener('change', event => { AppState.councilRosterType = event.target.value; AppState.render(); });
  const rosterProgramme = document.getElementById('councilRosterProgramme');
  if (rosterProgramme) rosterProgramme.addEventListener('change', event => { AppState.councilRosterProgramme = event.target.value; AppState.render(); });
  const search = document.getElementById('councilRosterSearch');
  if (search) search.addEventListener('input', event => {
    const cursor = event.target.selectionStart;
    AppState.councilRosterSearch = event.target.value;
    AppState.render();
    const nextSearch = document.getElementById('councilRosterSearch');
    nextSearch?.focus();
    nextSearch?.setSelectionRange(cursor, cursor);
  });
  document.querySelectorAll('.council-open-roster').forEach(button => button.addEventListener('click', () => openCouncilRoster(button.dataset.sectionId)));
  if (AppState.dashboardMode === 'council' && !AppState.supervisionData && !AppState.supervisionLoading && !AppState.supervisionError) {
    loadSupervisionData();
    return;
  }
  buildCouncilChart();
}