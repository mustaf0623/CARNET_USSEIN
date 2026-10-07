-- ============================================================
-- Carnet — Correctifs Amphithéâtre
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- (après amphitheatre-setup.sql, sur le même projet)
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Détection d'email élargie : "e.?mail" ne matchait que des
--    noms de colonne comme "Email"/"E-mail". On élargit à toute
--    clé contenant "mail" (insensible à la casse), pour couvrir
--    aussi "Adresse mail", "Mail", "Adresse e-mail", etc.
-- ------------------------------------------------------------
create or replace function public.try_auto_assign_utilisateur(target_section_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  matched record;
  my_email text;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null or trim(my_email) = '' then
    return jsonb_build_object('matched', false, 'reason', 'no_email');
  end if;

  select m.id, m.nom, m.prenom into matched
  from public.membres m
  where m.section_id = target_section_id
    and exists (
      select 1 from jsonb_each_text(coalesce(m.extra, '{}'::jsonb)) e(k, v)
      where k ~* '(mail|courriel|electronique|électronique)'
        and lower(regexp_replace(trim(regexp_replace(v, '^mailto:', '', 1, 1, 'i')), '[[:space:]]+', '', 'g'))
          = lower(regexp_replace(trim(regexp_replace(my_email, '^mailto:', '', 1, 1, 'i')), '[[:space:]]+', '', 'g'))
    )
  limit 1;

  if matched.id is null then
    return jsonb_build_object('matched', false, 'reason', 'no_match');
  end if;

  perform set_config('carnet.bypass_profile_guard', 'true', true);
  update public.profiles
  set role = 'utilisateur',
      section_id = target_section_id,
      active = true,
      name = coalesce(nullif(trim(matched.prenom || ' ' || matched.nom), ''), name),
      matched_membre_id = matched.id
  where id = auth.uid();
  perform set_config('carnet.bypass_profile_guard', 'false', true);

  return jsonb_build_object('matched', true, 'name', trim(matched.prenom || ' ' || matched.nom));
end;
$$;

-- ------------------------------------------------------------
-- 2) Attribution manuelle du rôle "utilisateur" par un
--    super-admin : jusqu'ici, l'admin pouvait poser role='utilisateur'
--    directement sur profiles sans jamais renseigner matched_membre_id,
--    laissant le compte bloqué (UFR/Filière introuvables côté client).
--    Cette fonction encapsule l'attribution manuelle et EXIGE un
--    membre correspondant, pour que matched_membre_id soit toujours
--    cohérent avec le rôle "utilisateur".
-- ------------------------------------------------------------
create or replace function public.admin_assign_role(
  target_user_id uuid,
  new_role text,
  new_section_id uuid,
  new_active boolean,
  new_matched_membre_id text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Seul un super-administrateur peut modifier les droits d''un compte';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ou statut actif — demandez à un autre super-administrateur';
  end if;
  if new_role = 'utilisateur' and new_matched_membre_id is null then
    raise exception 'Choisissez le membre correspondant pour attribuer le rôle Utilisateur';
  end if;
  if new_matched_membre_id is not null and not exists (
    select 1 from public.membres where id = new_matched_membre_id and section_id = new_section_id
  ) then
    raise exception 'Le membre choisi n''appartient pas à cette Section';
  end if;

  perform set_config('carnet.bypass_profile_guard', 'true', true);
  update public.profiles
  set role = new_role,
      section_id = new_section_id,
      active = new_active,
      -- Le rattachement à un membre n'a de sens que pour le rôle
      -- "utilisateur" : on l'efface systématiquement pour les autres
      -- rôles afin d'éviter une référence obsolète.
      matched_membre_id = case when new_role = 'utilisateur' then new_matched_membre_id else null end
  where id = target_user_id;
  perform set_config('carnet.bypass_profile_guard', 'false', true);
end;
$$;
