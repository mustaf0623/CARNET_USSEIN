-- ============================================================
-- Carnet — Amphithéâtre (module documents par UFR/Filière) +
-- renommage du rôle "utilisateur" en "CA" + nouveau rôle
-- "utilisateur" auto-attribué par correspondance d'email.
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- (sur le projet Supabase de index.html, celui AVEC Sections)
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Rôles : "utilisateur" (ancien sens = accès complet à la
--    Section) devient "ca". Le nom "utilisateur" est réutilisé
--    pour le nouveau rôle restreint à l'Amphithéâtre.
-- ------------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('utilisateur', 'ca', 'super_admin'));

-- Migration unique : tous les comptes qui avaient l'ancien rôle
-- "utilisateur" (accès complet, donc déjà rattachés à une Section)
-- deviennent "ca". Les comptes encore en attente (section_id vide)
-- ne sont pas touchés : ce sont de nouveaux comptes qui doivent
-- passer par le nouveau mécanisme d'auto-attribution.
update profiles set role = 'ca'
where role = 'utilisateur' and section_id is not null;

alter table profiles add column if not exists matched_membre_id text references membres(id) on delete set null;

-- ------------------------------------------------------------
-- 2) Autoriser le mécanisme d'auto-attribution à modifier le
--    profil de l'utilisateur courant sans passer par la
--    restriction "seul un super-admin peut changer les droits".
-- ------------------------------------------------------------
create or replace function public.protect_profile_attributes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('carnet.bypass_profile_guard', true) = 'true' then
    return new;
  end if;
  if auth.uid() is not null and new.id = auth.uid()
     and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ou statut actif — demandez à un autre super-administrateur';
  end if;
  if auth.uid() is not null and not public.is_super_admin()
     and (new.role is distinct from old.role
       or new.section_id is distinct from old.section_id
       or new.active is distinct from old.active
       or new.email is distinct from old.email) then
    raise exception 'Seul un super-administrateur peut modifier les droits d''un compte';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) Fonction d'auto-attribution : vérifie si l'email du compte
-- connecté figure dans les informations importées (colonne
-- "Email"/"E-mail"/variantes) des membres de la Section indiquée.
-- Si oui : rattache le compte à cette Section avec le rôle
-- "utilisateur", récupère son nom depuis la base importée, et
-- retient quel membre a été trouvé (pour retrouver UFR/Filière
-- même si elles changent plus tard). Ne révèle jamais la liste
-- des membres au client : tout se passe côté serveur.
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
-- 4) Restreindre les tables de pointage aux CA/super-admins.
-- Un simple "utilisateur" (Amphithéâtre) ne doit jamais pouvoir
-- écrire dans les données de pointage, même en contournant
-- l'interface.
-- ------------------------------------------------------------
create or replace function public.is_ca_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from public.profiles where id = auth.uid() and role = 'ca' and active = true
  );
$$;

drop policy if exists "section programmes" on programmes;
drop policy if exists "section membres" on membres;
drop policy if exists "section sessions" on sessions;
drop policy if exists "section pointages" on pointages;
create policy "section programmes" on programmes for all
  using (public.can_access_section(section_id) and public.is_ca_or_admin())
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
create policy "section membres" on membres for all
  using (public.can_access_section(section_id) and public.is_ca_or_admin())
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
create policy "section sessions" on sessions for all
  using (public.can_access_section(section_id) and public.is_ca_or_admin())
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
create policy "section pointages" on pointages for all
  using (public.can_access_section(section_id) and public.is_ca_or_admin())
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());

-- ------------------------------------------------------------
-- 5) Table des documents de l'Amphithéâtre.
-- ------------------------------------------------------------
create table if not exists amphi_documents (
  id text primary key,
  section_id uuid not null references sections(id) on delete cascade,
  ufr text not null,
  filiere text not null,
  type text not null check (type in ('cours', 'td', 'tp', 'lien')),
  titre text not null,
  reference text not null default '',
  file_name text,
  storage_path text,
  correction_file_name text,
  correction_storage_path text,
  lien_url text,
  uploader_name text not null default '',
  uploader_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table amphi_documents enable row level security;
drop policy if exists "section amphi_documents" on amphi_documents;
create policy "section amphi_documents" on amphi_documents for all
  using (public.can_access_section(section_id)) with check (public.can_access_section(section_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'amphi_documents') then
    alter publication supabase_realtime add table amphi_documents;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6) Stockage des fichiers (PDF, images, Word, PowerPoint).
-- Organisation des chemins : <section_id>/<ufr>/<filiere>/<fichier>
-- — le premier segment du chemin sert à vérifier les droits.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('amphi-documents', 'amphi-documents', false)
on conflict (id) do nothing;

drop policy if exists "amphi storage read" on storage.objects;
create policy "amphi storage read" on storage.objects for select
  using (bucket_id = 'amphi-documents' and public.can_access_section(((storage.foldername(name))[1])::uuid));

drop policy if exists "amphi storage insert" on storage.objects;
create policy "amphi storage insert" on storage.objects for insert
  with check (bucket_id = 'amphi-documents' and public.can_access_section(((storage.foldername(name))[1])::uuid));

drop policy if exists "amphi storage delete" on storage.objects;
create policy "amphi storage delete" on storage.objects for delete
  using (bucket_id = 'amphi-documents' and (public.is_super_admin() or owner = auth.uid()));
