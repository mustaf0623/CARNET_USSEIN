// export/xlsx-export.js — Construction de feuilles Excel (SheetJS) avec
// colonnes dimensionnées au contenu et mise en forme centrée/gras.
// SheetJS (XLSX) est chargé globalement via <script> dans index.html.

// Construit une feuille Excel avec des colonnes dimensionnées selon leur
// contenu (au lieu de la largeur fixe minuscule par défaut) et un contenu
// centré, en-tête en gras. Le centrage/gras dépend du moteur Excel utilisé
// pour ouvrir le fichier (Excel/LibreOffice l'appliquent ; certains
// lecteurs en ligne ignorent le style mais gardent toujours les bonnes
// largeurs de colonnes, qui elles s'appliquent partout.
export function buildStyledSheet(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map(h => {
    const maxLen = Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 3, 12), 42) };
  });
  ws['!rows'] = [{ hpt: 20 }];
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr];
        if (!cell) continue;
        cell.s = {
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          font: R === range.s.r ? { bold: true } : {},
        };
      }
    }
  }
  return ws;
}
