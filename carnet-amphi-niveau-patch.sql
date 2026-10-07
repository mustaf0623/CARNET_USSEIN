-- ============================================================
-- Carnet — Organisation des documents Amphithéâtre par niveau
-- (L1, L2, L3, M1, M2 — en plus de l'UFR et de la Filière)
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

alter table amphi_documents add column if not exists niveau text not null default '';

alter table amphi_documents drop constraint if exists amphi_documents_niveau_check;
alter table amphi_documents add constraint amphi_documents_niveau_check
  check (niveau in ('', 'L1', 'L2', 'L3', 'M1', 'M2'));
