// db/upload-queue.js — File d'attente hors-ligne pour les dépôts de
// documents de l'Amphithéâtre. Contrairement au reste des données de l'app
// (texte/nombres, toujours sauvegardées localement puis synchronisées en
// arrière-plan), un dépôt de document envoie un vrai fichier binaire : il
// n'y a pas de "sauvegarde locale silencieuse" possible sans un mécanisme
// dédié. Ce module fournit ce mécanisme : les fichiers en attente sont
// conservés tels quels dans IndexedDB (qui supporte nativement les objets
// File/Blob) jusqu'à ce que la connexion permette de les envoyer.
import { AppState, showToast } from '../state.js';
import { uid, AMPHI_TYPES_WITH_CORRECTION, isNetworkError } from '../config.js';
import { idbGet, idbSet } from './indexeddb.js';
import { saveData } from './data.js';
import { imageFileToPdfBlob } from '../export/pdf-export.js';

const UPLOAD_QUEUE_KEY = 'carnet-amphi-upload-queue';

async function persistQueue() {
  try { await idbSet(UPLOAD_QUEUE_KEY, AppState.amphiUploadQueue); }
  catch (e) { /* la file reste au moins disponible en mémoire pour cette session */ }
}

// À appeler une fois au démarrage : recharge les dépôts laissés en attente
// lors d'une session précédente (app fermée hors ligne avant reconnexion).
export async function initUploadQueue() {
  try { AppState.amphiUploadQueue = (await idbGet(UPLOAD_QUEUE_KEY)) || []; }
  catch (e) { AppState.amphiUploadQueue = []; }
}

async function uploadFileToStorage(file, ufr, filiere, sectionId) {
  const sb = AppState.sb;
  let uploadBlob = file;
  let ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  let finalName = file.name;
  // Les images sont converties en PDF proprement — les autres formats
  // (Word/PowerPoint/PDF déjà prêt) sont envoyés tels quels, comme convenu.
  if (file.type && file.type.startsWith('image/')) {
    uploadBlob = await imageFileToPdfBlob(file);
    ext = 'pdf';
    finalName = file.name.replace(/\.[^.]+$/, '') + '.pdf';
  }
  const safeBase = finalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '');
  const path = `${sectionId}/${encodeURIComponent(ufr)}/${encodeURIComponent(filiere)}/${uid()}-${safeBase}.${ext}`;
  const { error } = await sb.storage.from('amphi-documents').upload(path, uploadBlob, { upsert: false, contentType: uploadBlob.type || undefined });
  if (error) throw error;
  return { fileName: finalName, path };
}

// Exécute réellement l'envoi réseau (fichier(s) + insertion en base) pour un
// item de la file — utilisé aussi bien pour la tentative immédiate que pour
// le retraitement différé de la file d'attente.
async function performUpload(item) {
  const sb = AppState.sb;
  let fileName = '', storagePath = '', lienUrl = item.lienUrl || '';
  let correctionFileName = '', correctionStoragePath = '';
  if (item.type !== 'lien') {
    const uploaded = await uploadFileToStorage(item.file, item.ufr, item.filiere, item.sectionId);
    fileName = uploaded.fileName; storagePath = uploaded.path;
    if (AMPHI_TYPES_WITH_CORRECTION.includes(item.type) && item.correctionFile) {
      const uploadedCorr = await uploadFileToStorage(item.correctionFile, item.ufr, item.filiere, item.sectionId);
      correctionFileName = uploadedCorr.fileName; correctionStoragePath = uploadedCorr.path;
    }
  }
  const newDoc = {
    id: item.id, ufr: item.ufr, filiere: item.filiere, niveau: item.niveau || '', type: item.type, titre: item.titre, reference: item.reference,
    fileName, storagePath, correctionFileName, correctionStoragePath, lienUrl,
    uploaderName: item.uploaderName, uploaderUserId: item.uploaderUserId,
    createdAt: item.createdAt,
  };
  // Insertion DIRECTE et vérifiée (comme pour la suppression) : on veut
  // savoir immédiatement si le serveur a accepté, pas juste espérer qu'une
  // synchronisation en arrière-plan finisse par passer.
  const { error } = await sb.from('amphi_documents').insert({
    id: newDoc.id, section_id: item.sectionId, ufr: newDoc.ufr, filiere: newDoc.filiere, niveau: newDoc.niveau || '', type: newDoc.type,
    titre: newDoc.titre, reference: newDoc.reference || '',
    file_name: newDoc.fileName || null, storage_path: newDoc.storagePath || null,
    correction_file_name: newDoc.correctionFileName || null, correction_storage_path: newDoc.correctionStoragePath || null,
    lien_url: newDoc.lienUrl || null, uploader_name: newDoc.uploaderName || '', uploader_user_id: newDoc.uploaderUserId || null,
  });
  if (error) throw error;
  return newDoc;
}

async function commitLocalDoc(newDoc) {
  AppState.data.amphiDocuments = AppState.data.amphiDocuments || [];
  AppState.data.amphiDocuments.push(newDoc);
  await saveData();
}

// Point d'entrée principal, appelé depuis le formulaire de dépôt. Tente
// l'envoi tout de suite ; si la connexion manque (ou lâche en cours de
// route), le dépôt est automatiquement mis en file d'attente au lieu
// d'échouer sans retour possible.
export async function submitOrQueueAmphiDocument(itemBase) {
  if (!navigator.onLine) {
    await queueUpload(itemBase);
    return { queued: true };
  }
  try {
    const newDoc = await performUpload(itemBase);
    await commitLocalDoc(newDoc);
    return { queued: false, doc: newDoc };
  } catch (e) {
    if (isNetworkError(e)) {
      await queueUpload(itemBase);
      return { queued: true };
    }
    throw e;
  }
}

export async function queueUpload(item) {
  AppState.amphiUploadQueue = [...AppState.amphiUploadQueue, { ...item, status: 'pending', errorMessage: '' }];
  await persistQueue();
}

export async function removeQueueItem(id) {
  AppState.amphiUploadQueue = AppState.amphiUploadQueue.filter(q => q.id !== id);
  await persistQueue();
  AppState.render();
}

// Reprend la file d'attente en tâche de fond : appelé au retour en ligne et
// au démarrage. Traite les items un par un, s'arrête au premier échec qui
// ressemble à un problème réseau (pas la peine d'insister immédiatement),
// mais continue sur les erreurs "métier" (ex: permission refusée) pour ne
// pas bloquer les autres dépôts en attente à cause d'un seul en erreur.
let processing = false;
export async function processUploadQueue() {
  if (processing) return;
  if (!AppState.sb || !AppState.sbUser || !navigator.onLine) return;
  if (!AppState.amphiUploadQueue.length) return;
  processing = true;
  try {
    for (const item of AppState.amphiUploadQueue.slice()) {
      if (item.status === 'uploading') continue;
      item.status = 'uploading';
      AppState.render();
      try {
        const newDoc = await performUpload(item);
        await commitLocalDoc(newDoc);
        AppState.amphiUploadQueue = AppState.amphiUploadQueue.filter(q => q.id !== item.id);
        await persistQueue();
        showToast(`« ${item.titre} » envoyé (était en attente hors ligne)`);
      } catch (e) {
        item.status = 'error';
        item.errorMessage = (e && e.message) ? e.message : 'échec de l’envoi';
        await persistQueue();
        if (isNetworkError(e)) break;
      }
    }
  } finally {
    processing = false;
    AppState.render();
  }
}

export async function retryQueueItem(id) {
  const item = AppState.amphiUploadQueue.find(q => q.id === id);
  if (!item) return;
  item.status = 'pending'; item.errorMessage = '';
  await persistQueue();
  AppState.render();
  await processUploadQueue();
}
