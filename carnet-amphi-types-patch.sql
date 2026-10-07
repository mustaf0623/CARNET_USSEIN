-- ============================================================
-- Carnet — Nouveaux types de documents Amphithéâtre
-- (Devoir, Examen session normale, Examen session rattrapage)
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

alter table amphi_documents drop constraint if exists amphi_documents_type_check;
alter table amphi_documents add constraint amphi_documents_type_check
  check (type in ('cours', 'td', 'tp', 'lien', 'devoir', 'examen_normale', 'examen_rattrapage'));
