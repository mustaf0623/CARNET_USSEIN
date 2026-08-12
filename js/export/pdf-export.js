// export/pdf-export.js — Génération de documents PDF (jsPDF, chargé
// globalement via <script> dans index.html) : export tabulaire des membres,
// rapports de présence signés, et conversion image → PDF pour l'Amphithéâtre.

import { AppState } from '../state.js';
import { fmtDate, nowTime, todayISO, monthLabel, periodMatches, PDF_LOGO_PNG } from '../config.js';
import { programStats, sessionStats } from '../domain/stats.js';
import { memberInProgramme, isSortant } from '../domain/membres.js';

// Génère un PDF tabulaire (colonnes bornées et adaptées au contenu, police
// adaptative, pagination automatique avec en-tête répété) pour l'export de
// membres. Les valeurs très longues (liens, etc.) sont raccourcies pour le
// PDF uniquement — l'Excel garde toujours la valeur complète.
export function buildExportPdf(rows) {
  const { jsPDF } = window.jspdf;
  const headers = Object.keys(rows[0] || {});
  const landscape = headers.length > 5;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait' });
  const emeraldDk = [11, 122, 85], ink = [28, 42, 32], white = [255, 255, 255], track = [242, 245, 234], faint = [132, 146, 127];
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  const cellPad = 1.6;

  function truncateForPdf(v) {
    const s = String(v ?? '');
    if (/^https?:\/\//i.test(s)) return s.length > 26 ? s.slice(0, 23) + '…' : s;
    return s.length > 70 ? s.slice(0, 67) + '…' : s;
  }
  const displayRows = rows.map(row => {
    const r = {};
    headers.forEach(h => { r[h] = truncateForPdf(row[h]); });
    return r;
  });

  let fontSize = 8;
  if (headers.length > 8) fontSize = 7;
  if (headers.length > 12) fontSize = 6;
  if (headers.length > 16) fontSize = 5.3;
  const lineH = fontSize * 0.62 + 2.1;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(fontSize);
  const CHAR_W = fontSize * 0.21;
  const minW = Math.max(fontSize * 2.1, 11);
  const maxW = 52;
  const rawWidths = headers.map(h => {
    const maxLen = Math.max(String(h).length, ...displayRows.map(r => r[h].length), 3);
    return Math.min(Math.max(maxLen * CHAR_W, minW), maxW);
  });
  const totalRaw = rawWidths.reduce((a, b) => a + b, 0) || 1;
  const widths = rawWidths.map(w => (w / totalRaw) * contentW);

  let y = margin;
  function drawHeaderRow() {
    doc.setFillColor(...emeraldDk);
    doc.rect(margin, y, contentW, lineH + 2.2, 'F');
    doc.setTextColor(...white); doc.setFont('helvetica', 'bold'); doc.setFontSize(fontSize);
    let x = margin;
    headers.forEach((h, i) => {
      doc.text(String(h), x + cellPad, y + lineH, { maxWidth: widths[i] - cellPad * 2 });
      x += widths[i];
    });
    y += lineH + 2.2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...ink);
  }

  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(...ink);
  doc.text('Carnet — Export des membres', margin, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...faint);
  doc.text(`${rows.length} membre${rows.length > 1 ? 's' : ''} — généré le ${fmtDate(todayISO())} à ${nowTime()}`, margin, y);
  y += 6;
  drawHeaderRow();

  displayRows.forEach((row, idx) => {
    const cellLines = headers.map((h, i) => doc.splitTextToSize(row[h], widths[i] - cellPad * 2));
    const nLines = Math.max(1, ...cellLines.map(l => l.length));
    const rowH = nLines * lineH * 0.82 + 2.2;
    if (y + rowH > pageH - margin) { doc.addPage(); y = margin; drawHeaderRow(); }
    if (idx % 2 === 1) { doc.setFillColor(...track); doc.rect(margin, y, contentW, rowH, 'F'); }
    let x = margin;
    headers.forEach((h, i) => {
      doc.text(cellLines[i], x + cellPad, y + lineH * 0.82, { maxWidth: widths[i] - cellPad * 2 });
      x += widths[i];
    });
    y += rowH;
  });

  doc.save(`carnet-export-membres-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Convertit un fichier image en un blob PDF d'une page (utilisé par le dépôt
// de documents dans l'Amphithéâtre).
export async function imageFileToPdfBlob(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const { jsPDF } = window.jspdf;
  const orientation = img.width > img.height ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'pt', format: [img.width, img.height] });
  const mime = (file.type || '').includes('png') ? 'PNG' : 'JPEG';
  doc.addImage(dataUrl, mime, 0, 0, img.width, img.height);
  return doc.output('blob');
}

export function buildReportDoc(scope, yearFilter, sessionId) {
  yearFilter = yearFilter || 'toutes';
  const d = AppState.data;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const emerald = [15, 158, 110], emeraldDk = [11, 122, 85], ink = [28, 42, 32], faint = [132, 146, 127],
        terracotta = [225, 95, 30], gold = [196, 137, 15], track = [232, 232, 224], white = [255, 255, 255];
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentW = pageW - margin * 2;
  const scopeLabel = scope === 'global' ? 'Tous les programmes' : ((d.programmes.find(p => p.id === scope) || {}).nom || '');

  // ---------- Bandeau d'en-tête ----------
  doc.setFillColor(...emeraldDk);
  doc.rect(0, 0, pageW, 34, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 34, pageW, 1.4, 'F');
  try {
    doc.addImage(PDF_LOGO_PNG, 'PNG', margin - 0.5, 9.5, 13, 13);
  } catch (e) {
    doc.setFillColor(...white);
    doc.circle(margin + 6, 16, 6.5, 'F');
    doc.setFont('times', 'bold'); doc.setFontSize(13); doc.setTextColor(...emeraldDk);
    doc.text('C', margin + 6, 18.7, { align: 'center' });
  }
  doc.setFont('times', 'bold'); doc.setFontSize(19); doc.setTextColor(...white);
  doc.text('Carnet', margin + 17, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(230, 240, 235);
  doc.text('Rapport de présence', margin + 17, 21.5);
  doc.setFontSize(9); doc.setTextColor(230, 240, 235);
  const session = sessionId && sessionId !== 'toutes' ? d.sessions.find(s => s.id === sessionId) : null;
  doc.text(scopeLabel, pageW - margin, 13, { align: 'right' });
  if (session) {
    doc.text(session.label, pageW - margin, 18.5, { align: 'right' });
    doc.text(fmtDate(session.date) + '  ·  généré le ' + fmtDate(todayISO()) + ' à ' + nowTime(), pageW - margin, 23.5, { align: 'right' });
  } else {
    const periodLabel = yearFilter === 'toutes' ? '' : (yearFilter.length === 7 ? monthLabel(yearFilter) : 'Année ' + yearFilter) + '  ·  ';
    doc.text(periodLabel + fmtDate(todayISO()) + ' à ' + nowTime(), pageW - margin, 18.5, { align: 'right' });
  }

  let y = 48;

  // ============ RAPPORT D'UNE SÉANCE PRÉCISE ============
  if (session) {
    const membresSession = d.membres.filter(m => memberInProgramme(m, session.programmeId));
    const pointagesSession = d.pointages.filter(p => p.sessionId === session.id);
    const statutOf = (membreId) => { const pt = pointagesSession.find(p => p.membreId === membreId); return pt ? pt.statut : null; };
    const present = pointagesSession.filter(p => p.statut === 'present').length;
    const absent = pointagesSession.filter(p => p.statut === 'absent').length;
    const total = present + absent;
    const taux = total ? Math.round((present / total) * 100) : 0;

    doc.setFont('times', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...ink);
    doc.text('Séance : ' + session.label, margin, y);
    y += 6;

    const cardGap = 5;
    const cardW = (contentW - cardGap * 2) / 3;
    const cardH = 22;
    const cards = [
      { label: 'Présents', value: String(present), color: emerald },
      { label: 'Absents', value: String(absent), color: terracotta },
      { label: 'Taux de présence', value: taux + '%', color: emerald },
    ];
    cards.forEach((c, i) => {
      const cx = margin + i * (cardW + cardGap);
      doc.setFillColor(247, 247, 242);
      doc.roundedRect(cx, y, cardW, cardH, 2.4, 2.4, 'F');
      doc.setFillColor(...c.color);
      doc.roundedRect(cx, y, 2.2, cardH, 1.1, 1.1, 'F');
      doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(...c.color);
      doc.text(c.value, cx + 6, y + 12);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...faint);
      doc.text(c.label, cx + 6, y + 17.5);
    });
    y += cardH + 12;

    doc.setFont('times', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...ink);
    doc.text('Liste de présence', margin, y);
    y += 9;

    const ensureSpace2 = (needed) => { if (y + needed > 280) { doc.addPage(); y = 22; } };
    membresSession.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom)).forEach((m, i) => {
      ensureSpace2(9);
      const statut = statutOf(m.id);
      if (i % 2 === 0) { doc.setFillColor(247, 247, 242); doc.rect(margin, y - 5.5, contentW, 8, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...ink);
      doc.text(m.prenom + ' ' + m.nom, margin + 3, y);
      const label = statut === 'present' ? 'Présent' : statut === 'absent' ? 'Absent' : 'Non pointé';
      const color = statut === 'present' ? emerald : statut === 'absent' ? terracotta : faint;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...color);
      doc.text(label, pageW - margin - 3, y, { align: 'right' });
      y += 8;
    });
    if (!membresSession.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...faint);
      doc.text('Aucun membre inscrit à ce programme.', margin, y);
      y += 8;
    }

    const totalPagesSess = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPagesSess; i++) {
      doc.setPage(i);
      const pageH = doc.internal.pageSize.getHeight();
      doc.setDrawColor(...track);
      doc.line(margin, pageH - 22, pageW - margin, pageH - 22);
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(...ink);
      doc.text('Signé par ' + d.profile.name + ' — Commission Administrative', margin, pageH - 15);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...faint);
      doc.text('Généré automatiquement par Carnet le ' + fmtDate(todayISO()) + ' à ' + nowTime(), margin, pageH - 10.5);
      doc.text('Page ' + i + ' / ' + totalPagesSess, pageW - margin, pageH - 10.5, { align: 'right' });
    }

    const filenameSess = 'pointage-' + scopeLabel.toLowerCase().replace(/\s+/g, '-') + '-' + session.date + '.pdf';
    return { doc, filename: filenameSess };
  }

  const progsInScope = scope === 'global' ? d.programmes : d.programmes.filter(p => p.id === scope);
  const membresInScope = (scope === 'global' ? d.membres : d.membres.filter(m => memberInProgramme(m, scope))).filter(m => !m.ap && !isSortant(m));
  const nbH = membresInScope.filter(m => m.sexe === 'H').length;
  const nbF = membresInScope.filter(m => m.sexe === 'F').length;
  const globalPts = (scope === 'global' ? d.sessions : d.sessions.filter(s => s.programmeId === scope))
    .filter(s => periodMatches(s.date, yearFilter))
    .map(s => s.id);
  const ptsInScope = d.pointages.filter(p => globalPts.includes(p.sessionId));
  const presentCount = ptsInScope.filter(p => p.statut === 'present').length;
  const tauxGlobal = ptsInScope.length ? Math.round((presentCount / ptsInScope.length) * 100) : 0;

  // ---------- Cartes "Effectifs" ----------
  doc.setFont('times', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...ink);
  doc.text('Effectifs', margin, y);
  y += 6;

  const cardGap = 5;
  const cardW = (contentW - cardGap * 2) / 3;
  const cardH = 22;
  const cards = [
    { label: 'Membres inscrits', value: String(membresInScope.length), color: gold },
    { label: 'Hommes / Femmes', value: nbH + ' / ' + nbF, color: emerald },
    { label: 'Taux de présence', value: tauxGlobal + '%', color: emerald },
  ];
  cards.forEach((c, i) => {
    const cx = margin + i * (cardW + cardGap);
    doc.setFillColor(247, 247, 242);
    doc.roundedRect(cx, y, cardW, cardH, 2.4, 2.4, 'F');
    doc.setFillColor(...c.color);
    doc.roundedRect(cx, y, 2.2, cardH, 1.1, 1.1, 'F');
    doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(...c.color);
    doc.text(c.value, cx + 6, y + 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...faint);
    doc.text(c.label, cx + 6, y + 17.5);
  });
  y += cardH + 12;

  // ---------- Statistiques par programme ----------
  doc.setFont('times', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...ink);
  doc.text('Statistiques par programme', margin, y);
  y += 3;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...faint);
  doc.setFillColor(...emerald); doc.circle(margin + 1, y + 5.3, 1.1, 'F');
  doc.text('Présence', margin + 4, y + 6.2);
  doc.setFillColor(...terracotta); doc.circle(margin + 26, y + 5.3, 1.1, 'F');
  doc.text('Absence', margin + 29, y + 6.2);
  y += 12;

  const ensureSpace = (needed) => { if (y + needed > 280) { doc.addPage(); y = 22; } };

  progsInScope.forEach(p => {
    const s = programStats(d, p.id, yearFilter);
    ensureSpace(22);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...ink);
    doc.text(p.nom, margin, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...emeraldDk);
    doc.text(s.tauxPresence + '%', pageW - margin, y, { align: 'right' });
    y += 3.5;

    const barW = contentW;
    const barH = 3.4;
    doc.setFillColor(...track);
    doc.roundedRect(margin, y, barW, barH, 1.7, 1.7, 'F');
    if (s.tauxPresence > 0) {
      doc.setFillColor(...emerald);
      doc.roundedRect(margin, y, Math.max(barW * s.tauxPresence / 100, barH), barH, 1.7, 1.7, 'F');
    }
    y += barH + 4.5;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...faint);
    doc.text(s.nbMembres + ' membre' + (s.nbMembres > 1 ? 's' : '') + '   ·   ' + s.nbSessions + ' séance' + (s.nbSessions > 1 ? 's' : '') + '   ·   participation ' + s.tauxParticipation + '%', margin, y);
    y += 9;
  });

  if (!progsInScope.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...faint);
    doc.text('Aucun programme dans cette portée.', margin, y);
    y += 10;
  }

  // ---------- Pied de page : signature + numérotation ----------
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...track);
    doc.line(margin, pageH - 22, pageW - margin, pageH - 22);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(...ink);
    doc.text('Signé par ' + d.profile.name + ' — Commission Administrative', margin, pageH - 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...faint);
    doc.text('Généré automatiquement par Carnet le ' + fmtDate(todayISO()) + ' à ' + nowTime(), margin, pageH - 10.5);
    doc.text('Page ' + i + ' / ' + totalPages, pageW - margin, pageH - 10.5, { align: 'right' });
  }

  const filename = 'rapport-' + (scope === 'global' ? 'global' : scopeLabel.toLowerCase().replace(/\s+/g, '-')) + (yearFilter !== 'toutes' ? '-' + yearFilter : '') + '-' + todayISO() + '.pdf';
  return { doc, filename };
}

export function downloadPdf(scope, yearFilter, sessionId) {
  const { doc, filename } = buildReportDoc(scope, yearFilter, sessionId);
  doc.save(filename);
}
