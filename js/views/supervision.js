// Vue de supervision multi-Sections, réservée au super-administrateur.
import { AppState, showToast } from '../state.js';
import { escapeHtml, isNetworkError } from '../config.js';
import { idbGet, idbSet } from '../db/indexeddb.js';
import { statCard } from '../components/ui.js';
import { buildExportPdf } from '../export/pdf-export.js';
import { buildStyledSheet } from '../export/xlsx-export.js';

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

function hasProgrammeBreakdown(data) {
  return data.programmes.every(row => typeof row.nom === 'string')
    && data.sessions.every(row => typeof row.programme_id === 'string')
    && data.membres.every(row => Array.isArray(row.programme_ids) || row.all_programmes === true);
}

function applySupervisionCache(cache) {
  if (!cache?.data) return false;
  AppState.supervisionData = cache.data;
  AppState.supervisionCacheInfo = { source: 'cache', fetchedAt: cache.fetchedAt, sectionIds: cache.sectionIds || [], programmeBreakdownAvailable: hasProgrammeBreakdown(cache.data) };
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
      fetchAll('programmes', 'id, section_id, nom', sectionIds),
      fetchAll('membres', 'id, section_id, ap, sortant_since, programme_ids, all_programmes', sectionIds),
      fetchAll('sessions', 'id, section_id, programme_id, date', sectionIds),
      fetchAll('pointages', 'id, section_id, session_id, statut', sectionIds),
      fetchAll('amphi_documents', 'id, section_id, created_at', sectionIds),
      fetchAll('observations', 'id, section_id, created_at', sectionIds),
    ]);
    AppState.supervisionData = { programmes, membres, sessions, pointages, documents, observations };
    AppState.supervisionCacheInfo = { source: 'network', fetchedAt: new Date().toISOString(), sectionIds, programmeBreakdownAvailable: true };
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

function weekStart(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

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

function collectStats(data, period, selectedSection, selectedProgramme) {
  const start = periodStart(period);
  const sectionIds = selectedSection === 'all' ? null : new Set([selectedSection]);
  const includesSection = sectionId => !sectionIds || sectionIds.has(sectionId);
  const members = data.membres.filter(row => includesSection(row.section_id));
  const programmes = data.programmes.filter(row => includesSection(row.section_id) && (selectedProgramme === 'all' || row.id === selectedProgramme));
  const documents = data.documents.filter(row => includesSection(row.section_id) && (!start || row.created_at.slice(0, 10) >= start));
  const observations = data.observations.filter(row => includesSection(row.section_id) && (!start || row.created_at.slice(0, 10) >= start));
  const sessions = data.sessions.filter(row => includesSection(row.section_id) && (selectedProgramme === 'all' || row.programme_id === selectedProgramme) && (!start || row.date >= start));
  const sections = AppState.sbSections.filter(section => includesSection(section.id)).map(section => ({
    section,
    members: members.filter(row => row.section_id === section.id && !row.ap && !row.sortant_since
      && (selectedProgramme === 'all' || row.all_programmes || (row.programme_ids || []).includes(selectedProgramme))).length,
    programmes: programmes.filter(row => row.section_id === section.id).length,
    documents: documents.filter(row => row.section_id === section.id).length,
    observations: observations.filter(row => row.section_id === section.id).length,
    sessions: sessions.filter(row => row.section_id === section.id),
    present: 0,
    total: 0,
    weeklyByProgramme: new Map(),
  }));
  const byId = new Map(sections.map(row => [row.section.id, row]));
  const bySessionId = new Map();

  sessions.forEach(session => {
    const key = weekStart(session.date);
    const target = byId.get(session.section_id);
    if (target && !target.weeklyByProgramme.has(session.programme_id)) target.weeklyByProgramme.set(session.programme_id, new Map());
    const programmeWeeks = target?.weeklyByProgramme.get(session.programme_id);
    if (programmeWeeks && !programmeWeeks.has(key)) programmeWeeks.set(key, { present: 0, total: 0, sessions: 0 });
    if (programmeWeeks) programmeWeeks.get(key).sessions++;
    bySessionId.set(session.id, session);
  });
  data.pointages.forEach(pointage => {
    const session = bySessionId.get(pointage.session_id);
    const target = session && byId.get(session.section_id);
    if (!target) return;
    const key = weekStart(session.date);
    const week = target.weeklyByProgramme.get(session.programme_id)?.get(key);
    if (!week) return;
    target.total++;
    week.total++;
    if (pointage.statut === 'present') {
      target.present++;
      week.present++;
    }
  });

  const weeklyByProgramme = new Map();
  sections.forEach(row => row.weeklyByProgramme.forEach((weeks, programmeId) => {
    if (!weeklyByProgramme.has(programmeId)) weeklyByProgramme.set(programmeId, new Map());
    const programmeWeeks = weeklyByProgramme.get(programmeId);
    weeks.forEach((value, key) => {
      if (!programmeWeeks.has(key)) programmeWeeks.set(key, { present: 0, total: 0, sessions: 0 });
      const total = programmeWeeks.get(key);
      total.present += value.present;
      total.total += value.total;
      total.sessions += value.sessions;
    });
  }));
  return { sections, weeklyByProgramme, programmes };
}

function reportPeriodLabel(period) {
  if (period === 'all') return 'Depuis le début';
  if (period === 'year') return `Année ${new Date().getFullYear()}`;
  return '12 derniers mois';
}

function reportFilePart(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function createSupervisionReport(data) {
  const period = AppState.supervisionPeriod || '12m';
  const selectedSection = AppState.supervisionSection || 'all';
  const sectionProgrammes = data.programmes.filter(programme => selectedSection === 'all' || programme.section_id === selectedSection);
  const selectedProgramme = sectionProgrammes.some(programme => programme.id === AppState.supervisionProgramme)
    ? AppState.supervisionProgramme
    : 'all';
  const start = periodStart(period);
  const sessions = data.sessions.filter(session => (selectedSection === 'all' || session.section_id === selectedSection)
    && (selectedProgramme === 'all' || session.programme_id === selectedProgramme)
    && (!start || session.date >= start));
  const programmeById = new Map(data.programmes.map(programme => [programme.id, programme]));
  const sectionById = new Map(AppState.sbSections.map(section => [section.id, section]));
  const buckets = new Map();
  const bucketBySession = new Map();

  sessions.forEach(session => {
    const week = weekStart(session.date);
    const key = `${session.section_id}\u0000${session.programme_id}\u0000${week}`;
    if (!buckets.has(key)) {
      buckets.set(key, { sectionId: session.section_id, programmeId: session.programme_id, week, sessionIds: new Set(), pointedSessionIds: new Set(), present: 0, total: 0 });
    }
    const bucket = buckets.get(key);
    bucket.sessionIds.add(session.id);
    bucketBySession.set(session.id, bucket);
  });

  data.pointages.forEach(pointage => {
    const bucket = bucketBySession.get(pointage.session_id);
    if (!bucket) return;
    bucket.total++;
    bucket.pointedSessionIds.add(pointage.session_id);
    if (pointage.statut === 'present') bucket.present++;
  });

  const detailRows = [...buckets.values()].sort((a, b) => a.week.localeCompare(b.week)
    || (sectionById.get(a.sectionId)?.nom || '').localeCompare(sectionById.get(b.sectionId)?.nom || '')
    || (programmeById.get(a.programmeId)?.nom || '').localeCompare(programmeById.get(b.programmeId)?.nom || ''))
    .map(bucket => {
      const programme = programmeById.get(bucket.programmeId);
      const section = sectionById.get(bucket.sectionId);
      return {
        'Section': section?.nom || 'Section',
        'Programme': programme?.nom || 'Programme',
        'Semaine du': weekLabel(bucket.week),
        'Séances prévues': bucket.sessionIds.size,
        'Séances avec pointage': bucket.pointedSessionIds.size,
        'Présences': bucket.present,
        'Absences pointées': bucket.total - bucket.present,
        'Pointages enregistrés': bucket.total,
        'Taux de présence': bucket.total ? `${Math.round(bucket.present / bucket.total * 100)} %` : '—',
      };
    });

  const summary = new Map();
  buckets.forEach(bucket => {
    const key = `${bucket.sectionId}\u0000${bucket.programmeId}`;
    if (!summary.has(key)) summary.set(key, {
      sectionId: bucket.sectionId,
      programmeId: bucket.programmeId,
      weeks: new Set(),
      'Séances prévues': 0,
      'Séances avec pointage': 0,
      Présences: 0,
      'Absences pointées': 0,
      'Pointages enregistrés': 0,
    });
    const total = summary.get(key);
    total.weeks.add(bucket.week);
    total['Séances prévues'] += bucket.sessionIds.size;
    total['Séances avec pointage'] += bucket.pointedSessionIds.size;
    total.Présences += bucket.present;
    total['Absences pointées'] += bucket.total - bucket.present;
    total['Pointages enregistrés'] += bucket.total;
  });
  const summaryRows = [...summary.values()].map(row => {
    const programme = programmeById.get(row.programmeId);
    const section = sectionById.get(row.sectionId);
    return {
      Section: section?.nom || 'Section',
      Programme: programme?.nom || 'Programme',
      'Membres actifs inscrits': data.membres.filter(member => member.section_id === row.sectionId
        && !member.ap && !member.sortant_since
        && (member.all_programmes || (member.programme_ids || []).includes(row.programmeId))).length,
      'Semaines avec séance': row.weeks.size,
      'Séances prévues': row['Séances prévues'],
      'Séances avec pointage': row['Séances avec pointage'],
      Présences: row.Présences,
      'Absences pointées': row['Absences pointées'],
      'Pointages enregistrés': row['Pointages enregistrés'],
      'Taux de présence': row['Pointages enregistrés']
        ? `${Math.round(row.Présences / row['Pointages enregistrés'] * 100)} %`
        : '—',
    };
  });

  const selectedSectionName = selectedSection === 'all'
    ? 'toutes-sections'
    : reportFilePart(sectionById.get(selectedSection)?.nom || 'section');
  const selectedProgrammeName = selectedProgramme === 'all'
    ? 'tous-programmes'
    : reportFilePart(programmeById.get(selectedProgramme)?.nom || 'programme');
  return {
    detailRows,
    summaryRows,
    sectionLabel: selectedSection === 'all' ? 'Toutes les Sections' : sectionById.get(selectedSection)?.nom || 'Section',
    programmeLabel: selectedProgramme === 'all' ? 'Tous les programmes' : programmeById.get(selectedProgramme)?.nom || 'Programme',
    periodLabel: reportPeriodLabel(period),
    filename: `carnet-supervision-${selectedSectionName}-${selectedProgrammeName}-${period}-${new Date().toISOString().slice(0, 10)}`,
  };
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
  const sectionProgrammes = AppState.supervisionData.programmes.filter(programme => selectedSection === 'all' || programme.section_id === selectedSection);
  const selectedProgramme = sectionProgrammes.some(programme => programme.id === AppState.supervisionProgramme)
    ? AppState.supervisionProgramme
    : 'all';
  const { sections, programmes } = collectStats(AppState.supervisionData, period, selectedSection, selectedProgramme);
  const cacheInfo = AppState.supervisionCacheInfo;
  const programmeBreakdownAvailable = cacheInfo?.programmeBreakdownAvailable !== false;
  const cachedSectionCount = new Set(cacheInfo?.sectionIds || []).size;
  const coverageNotice = (!navigator.onLine || cacheInfo?.source === 'cache')
    ? `<div class="supervision-cache-notice" role="status">Hors ligne · copie enregistrée le ${cacheInfo?.fetchedAt ? new Date(cacheInfo.fetchedAt).toLocaleString('fr-FR') : 'date inconnue'} · ${cachedSectionCount} Section${cachedSectionCount === 1 ? '' : 's'} incluse${cachedSectionCount === 1 ? '' : 's'} lors du dernier chargement. Ces données peuvent être anciennes.${programmeBreakdownAvailable ? '' : ' Le détail par programme nécessite une actualisation en ligne.'}</div>`
    : '';
  const totalMembers = sections.reduce((sum, row) => sum + row.members, 0);
  const totalSessions = sections.reduce((sum, row) => sum + row.sessions.length, 0);
  const present = sections.reduce((sum, row) => sum + row.present, 0);
  const total = sections.reduce((sum, row) => sum + row.total, 0);
  const absent = total - present;
  const rate = total ? Math.round(present / total * 100) : null;
  const interval = wilsonInterval(present, total);
  const ordered = [...sections].sort((a, b) => (b.total ? b.present / b.total : -1) - (a.total ? a.present / a.total : -1));
  const reportAvailable = programmeBreakdownAvailable && totalSessions > 0;
  const sectionOptions = `<option value="all">Toutes les Sections</option>${AppState.sbSections.map(section => `<option value="${section.id}" ${selectedSection === section.id ? 'selected' : ''}>${escapeHtml(section.nom)}</option>`).join('')}`;
  const programmeOptions = `<option value="all">Tous les programmes</option>${sectionProgrammes.map(programme => `<option value="${programme.id}" ${selectedProgramme === programme.id ? 'selected' : ''}>${escapeHtml(programme.nom || 'Programme')}</option>`).join('')}`;
  const periodOptions = `<option value="12m" ${period === '12m' ? 'selected' : ''}>12 derniers mois</option><option value="year" ${period === 'year' ? 'selected' : ''}>Année en cours</option><option value="all" ${period === 'all' ? 'selected' : ''}>Depuis le début</option>`;
  const rows = ordered.map(row => {
    const rowRate = row.total ? Math.round(row.present / row.total * 100) : null;
    const rowInterval = wilsonInterval(row.present, row.total);
    const lastSession = row.sessions.map(session => session.date).sort().at(-1) || '';
    const attendance = rowRate === null
      ? '<span class="supervision-rate-empty">Aucun pointage</span>'
      : `<div class="supervision-rate-head"><strong>${rowRate}%</strong><span>${row.present.toLocaleString('fr-FR')} présents · ${(row.total - row.present).toLocaleString('fr-FR')} absences</span></div><div class="supervision-rate-bar" role="img" aria-label="${rowRate}% de présence"><span style="width:${rowRate}%"></span></div><span class="supervision-rate-detail">${rowInterval ? `IC 95 % : ${Math.round(rowInterval[0])}–${Math.round(rowInterval[1])}% · ` : ''}${row.total.toLocaleString('fr-FR')} pointages</span>`;
    return `<tr><td><button class="supervision-section-link" data-section-id="${row.section.id}">${escapeHtml(row.section.nom)}</button></td><td>${row.members}</td><td>${row.programmes}</td><td>${row.sessions.length}</td><td class="supervision-rate-cell">${attendance}</td><td>${row.documents}</td><td>${row.observations}</td><td>${lastSession ? new Date(lastSession + 'T00:00:00').toLocaleDateString('fr-FR') : '—'}</td></tr>`;
  }).join('');

  const attendanceScope = selectedProgramme === 'all' ? 'tous les programmes' : `programme ${escapeHtml(programmes.find(programme => programme.id === selectedProgramme)?.nom || '')}`;
  return `${coverageNotice}<div class="page-head supervision-head"><div><div class="eyebrow">Pilotage multi-Sections</div><h1 class="page-title">Supervision</h1><p class="page-sub">Suivre l’assiduité semaine par semaine, par programme et par Section.</p></div>
      <div class="supervision-filters"><label class="field"><span>Période</span><select id="supervisionPeriod">${periodOptions}</select></label><label class="field"><span>Section</span><select id="supervisionSection">${sectionOptions}</select></label><label class="field supervision-programme-filter"><span>Programme</span><select id="supervisionProgramme" ${programmeBreakdownAvailable ? '' : 'disabled'}>${programmeOptions}</select></label><button class="btn btn-ghost supervision-refresh" id="supervisionRefresh" title="Actualiser les données" aria-label="Actualiser les données">↻</button></div></div>
    <section class="grid grid-4 supervision-kpis" aria-label="Indicateurs globaux">
      ${statCard('Membres actifs', totalMembers.toLocaleString('fr-FR'), `${attendanceScope} · hors sortants et ponctuels`, 'stat-emerald')}
      ${statCard('Séances enregistrées', totalSessions.toLocaleString('fr-FR'), `${attendanceScope} · sur la période`, 'stat-gold')}
      ${statCard('Présence observée', rate === null ? '—' : rate + '%', total ? `${present.toLocaleString('fr-FR')} présents sur ${total.toLocaleString('fr-FR')} pointages · IC 95 % : ${Math.round(interval[0])}–${Math.round(interval[1])}%` : 'Aucun pointage sur cette période', 'stat-emerald')}
      ${statCard('Absences pointées', absent.toLocaleString('fr-FR'), total ? `${Math.round(absent / total * 100)} % des pointages enregistrés` : 'Aucun pointage sur cette période', 'stat-terracotta')}
    </section>
    <section class="grid grid-2 supervision-chart-grid">
      <article class="card supervision-panel supervision-trend-panel"><div class="supervision-panel-head"><div><h3 class="card-title">Présence hebdomadaire par programme</h3><p class="card-sub">Taux de présence calculé chaque semaine à partir des pointages enregistrés.</p></div><span class="supervision-unit">% présence</span></div>${programmeBreakdownAvailable ? '<div class="supervision-chart"><canvas id="supervisionTrend" aria-label="Évolution hebdomadaire du taux de présence par programme"></canvas></div>' : '<p class="supervision-footnote">Les données locales ne contiennent pas encore le détail par programme. Connectez-vous puis actualisez les données.</p>'}</article>
      <article class="card supervision-panel"><div class="supervision-panel-head"><div><h3 class="card-title">Présence par Section</h3><p class="card-sub">Comparer le taux et le volume de pointages sur la période.</p></div><span class="supervision-unit">${sections.length} Sections</span></div><div class="supervision-chart supervision-ranking-chart" style="height:${Math.max(280, sections.length * 38)}px"><canvas id="supervisionRanking" aria-label="Comparaison des taux de présence par Section"></canvas></div><p class="supervision-footnote">Les pointages enregistrés sont le dénominateur : les personnes non pointées ne sont pas comptées comme absentes.</p></article>
    </section>
    <section class="card supervision-panel supervision-table-panel"><div class="supervision-panel-head"><div><h3 class="card-title">Détail par Section</h3><p class="card-sub">Activité et assiduité sur la période. Les dépôts et observations sont des totaux de Section, indépendants du programme choisi.</p></div><span class="supervision-count">${sections.length} Sections</span></div><div class="supervision-report-actions"><span>Rapport selon les filtres sélectionnés : ${escapeHtml(selectedSection === 'all' ? 'toutes les Sections' : AppState.sbSections.find(section => section.id === selectedSection)?.nom || 'Section')} · ${escapeHtml(selectedProgramme === 'all' ? 'tous les programmes' : programmes.find(programme => programme.id === selectedProgramme)?.nom || 'Programme')} · ${escapeHtml(reportPeriodLabel(period))}</span><div><button class="btn btn-primary btn-sm" id="supervisionReportPdf" ${reportAvailable ? '' : 'disabled'}>Générer PDF</button><button class="btn btn-ghost btn-sm" id="supervisionReportXlsx" ${reportAvailable ? '' : 'disabled'}>Exporter Excel</button></div></div>${totalSessions ? '' : '<p class="supervision-footnote">Aucune séance dans cette portée et cette période : aucun rapport à générer.</p>'}<div class="supervision-table-scroll"><table class="supervision-table"><thead><tr><th>Section</th><th>Membres actifs</th><th>Programmes</th><th>Séances</th><th>Présence et volume</th><th>Dépôts Amphi</th><th>Observations</th><th>Dernière séance</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Aucune Section disponible.</td></tr>'}</tbody></table></div><p class="supervision-footnote">Le fichier Excel contient une synthèse par Section/programme et le détail semaine par semaine. Les absences comptent uniquement les pointages marqués absent.</p></section>`;
}

function buildCharts() {
  charts.forEach(chart => chart.destroy());
  charts = [];
  if (!window.Chart || !AppState.supervisionData) return;
  const selectedSection = AppState.supervisionSection || 'all';
  const sectionProgrammes = AppState.supervisionData.programmes.filter(programme => selectedSection === 'all' || programme.section_id === selectedSection);
  const selectedProgramme = sectionProgrammes.some(programme => programme.id === AppState.supervisionProgramme)
    ? AppState.supervisionProgramme
    : 'all';
  const { sections, weeklyByProgramme, programmes } = collectStats(AppState.supervisionData, AppState.supervisionPeriod || '12m', selectedSection, selectedProgramme);
  const trendCanvas = document.getElementById('supervisionTrend');
  const programmeIds = [...weeklyByProgramme.keys()];
  const keys = [...new Set([...weeklyByProgramme.values()].flatMap(weeks => [...weeks.keys()]))].sort();
  if (trendCanvas) {
    const datasets = programmeIds.map((programmeId, index) => {
      const weeks = weeklyByProgramme.get(programmeId);
      return {
        label: programmes.find(programme => programme.id === programmeId)?.nom || 'Programme',
        data: keys.map(key => {
          const value = weeks.get(key);
          return value && value.total ? Math.round(value.present / value.total * 100) : null;
        }),
        borderColor: COLORS[index % COLORS.length],
        backgroundColor: COLORS[index % COLORS.length],
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.25,
        spanGaps: false,
      };
    });
    charts.push(new Chart(trendCanvas, {
      type: 'line',
      data: { labels: keys.map(weekLabel), datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, color: '#4A5578', font: { family: 'Manrope', size: 11 } } }, tooltip: { callbacks: {
        label: context => context.parsed.y === null ? `${context.dataset.label} : aucun pointage` : `${context.dataset.label} : ${context.parsed.y}%`,
        afterLabel: context => {
          const programmeId = programmeIds[context.datasetIndex];
          const value = weeklyByProgramme.get(programmeId).get(keys[context.dataIndex]);
          if (!value) return [];
          return [`${value.present} présents · ${value.total - value.present} absences`, `${value.total} pointages · ${value.sessions} séances`];
        },
      } } }, scales: { y: { min: 0, max: 100, ticks: { callback: value => value + '%', color: '#8A8F72' }, grid: { color: 'rgba(28,37,65,0.08)' } }, x: { ticks: { color: '#4A5578', maxRotation: 0, autoSkip: true }, grid: { display: false } } } },
    }));
  }

  const rankingCanvas = document.getElementById('supervisionRanking');
  if (!rankingCanvas) return;
  const ordered = [...sections].sort((a, b) => (b.total ? b.present / b.total : -1) - (a.total ? a.present / a.total : -1));
  charts.push(new Chart(rankingCanvas, {
    type: 'bar',
    data: {
      labels: ordered.map(row => row.section.nom),
      datasets: [{
        label: 'Présence',
        data: ordered.map(row => row.total ? Math.round(row.present / row.total * 100) : null),
        backgroundColor: ordered.map((_, index) => COLORS[index % COLORS.length]),
        borderRadius: 5,
        barThickness: 16,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => context.parsed.x === null ? 'Aucun pointage' : `Présence : ${context.parsed.x}%`,
            afterLabel: context => {
              const row = ordered[context.dataIndex];
              return [`Présents : ${row.present.toLocaleString('fr-FR')}`, `Absences : ${(row.total - row.present).toLocaleString('fr-FR')}`, `Pointages : ${row.total.toLocaleString('fr-FR')}`];
            },
          },
        },
      },
      scales: {
        x: { min: 0, max: 100, ticks: { callback: value => value + '%', color: '#8A8F72' }, grid: { color: 'rgba(28,37,65,0.08)' } },
        y: { ticks: { color: '#4A5578', autoSkip: false }, grid: { display: false } },
      },
    },
  }));
}

export function attachSupervisionEvents() {
  if (!AppState.supervisionData && !AppState.supervisionLoading && !AppState.supervisionError) {
    loadData();
    return;
  }
  const period = document.getElementById('supervisionPeriod');
  if (period) period.addEventListener('change', event => { AppState.supervisionPeriod = event.target.value; AppState.render(); });
  const section = document.getElementById('supervisionSection');
  if (section) section.addEventListener('change', event => { AppState.supervisionSection = event.target.value; AppState.supervisionProgramme = 'all'; AppState.render(); });
  const programme = document.getElementById('supervisionProgramme');
  if (programme) programme.addEventListener('change', event => { AppState.supervisionProgramme = event.target.value; AppState.render(); });
  const refresh = document.getElementById('supervisionRefresh');
  if (refresh) refresh.addEventListener('click', loadData);
  const reportPdf = document.getElementById('supervisionReportPdf');
  if (reportPdf) reportPdf.addEventListener('click', () => {
    try {
      const report = createSupervisionReport(AppState.supervisionData);
      if (!report.detailRows.length) {
        showToast('Aucune séance à inclure pour ces filtres');
        return;
      }
      buildExportPdf(report.detailRows, {
        title: 'Carnet — Rapport de supervision',
        description: `${report.sectionLabel} · ${report.programmeLabel} · ${report.periodLabel} · Généré le ${new Date().toLocaleDateString('fr-FR')}`,
        filename: `${report.filename}.pdf`,
      });
      showToast('Rapport de supervision PDF généré');
    } catch (error) {
      showToast(`Impossible de générer le rapport PDF : ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  });
  const reportXlsx = document.getElementById('supervisionReportXlsx');
  if (reportXlsx) reportXlsx.addEventListener('click', () => {
    try {
      const report = createSupervisionReport(AppState.supervisionData);
      if (!report.detailRows.length) {
        showToast('Aucune séance à inclure pour ces filtres');
        return;
      }
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, buildStyledSheet(report.summaryRows), 'Synthèse');
      XLSX.utils.book_append_sheet(workbook, buildStyledSheet(report.detailRows), 'Détail hebdomadaire');
      XLSX.writeFile(workbook, `${report.filename}.xlsx`);
      showToast('Rapport de supervision Excel généré');
    } catch (error) {
      showToast(`Impossible de générer le rapport Excel : ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    }
  });
  const retry = document.getElementById('supervisionRetry');
  if (retry) retry.addEventListener('click', loadData);
  document.querySelectorAll('.supervision-section-link').forEach(button => button.addEventListener('click', () => {
    AppState.supervisionSection = button.dataset.sectionId;
    AppState.supervisionProgramme = 'all';
    AppState.render();
  }));
  buildCharts();
}