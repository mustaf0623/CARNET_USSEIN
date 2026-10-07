-- ============================================================
-- Carnet — schéma Supabase (version rejouable sans erreur)
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

-- Profil personnel (nom du signataire), un par utilisateur connecté
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz default now()
);

-- Données partagées par toute la Commission (un seul espace de travail)
create table if not exists programmes (
  id text primary key,
  nom text not null,
  updated_at timestamptz default now()
);

create table if not exists membres (
  id text primary key,
  nom text not null,
  prenom text not null,
  sexe text not null check (sexe in ('H','F')),
  programme_ids text[] not null default '{}',
  all_programmes boolean not null default false,
  ap boolean not null default false,
  updated_at timestamptz default now()
);

create table if not exists sessions (
  id text primary key,
  programme_id text not null references programmes(id) on delete cascade,
  date date not null,
  label text not null,
  updated_at timestamptz default now()
);

create table if not exists pointages (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  membre_id text not null references membres(id) on delete cascade,
  statut text not null check (statut in ('present','absent')),
  updated_at timestamptz default now()
);

-- ============================================================
-- Sécurité (RLS) : tout utilisateur connecté peut lire/écrire les
-- données partagées ; chacun ne gère que son propre profil.
-- Chaque politique est supprimée puis recréée : sans danger à rejouer.
-- ============================================================
alter table profiles enable row level security;
alter table programmes enable row level security;
alter table membres enable row level security;
alter table sessions enable row level security;
alter table pointages enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "shared read/write programmes" on programmes;
create policy "shared read/write programmes" on programmes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "shared read/write membres" on membres;
create policy "shared read/write membres" on membres
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "shared read/write sessions" on sessions;
create policy "shared read/write sessions" on sessions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "shared read/write pointages" on pointages;
create policy "shared read/write pointages" on pointages
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- Temps réel : permet aux autres appareils de voir les changements.
-- Bloc protégé : ne réagit pas si une table est déjà dans la publication.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'programmes'
  ) then
    alter publication supabase_realtime add table programmes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'membres'
  ) then
    alter publication supabase_realtime add table membres;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table sessions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pointages'
  ) then
    alter publication supabase_realtime add table pointages;
  end if;
end $$;

-- ============================================================
-- Sections et accès : à exécuter une fois pour passer du carnet
-- partagé à des espaces séparés par Section.
-- ============================================================
create table if not exists sections (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists email text;
alter table profiles add column if not exists role text not null default 'utilisateur'
  check (role in ('utilisateur', 'super_admin'));
alter table profiles add column if not exists section_id uuid references sections(id) on delete set null;
alter table profiles add column if not exists active boolean not null default true;

alter table programmes add column if not exists section_id uuid references sections(id) on delete cascade;
alter table membres add column if not exists section_id uuid references sections(id) on delete cascade;
alter table sessions add column if not exists section_id uuid references sections(id) on delete cascade;
alter table pointages add column if not exists section_id uuid references sections(id) on delete cascade;

-- Les données déjà présentes sont placées dans la première Section.
insert into sections (nom) values ('USSEIN') on conflict (nom) do nothing;
do $$
declare default_section uuid;
begin
  select id into default_section from sections where nom = 'USSEIN';
  update programmes set section_id = default_section where section_id is null;
  update membres set section_id = default_section where section_id is null;
  update sessions set section_id = default_section where section_id is null;
  update pointages set section_id = default_section where section_id is null;
end $$;

alter table programmes alter column section_id set not null;
alter table membres alter column section_id set not null;
alter table sessions alter column section_id set not null;
alter table pointages alter column section_id set not null;

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.create_profile_for_user();

insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do update set email = coalesce(public.profiles.email, excluded.email);

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and active = true
  );
$$;

create or replace function public.can_access_section(target_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true and section_id = target_section
  );
$$;

create or replace function public.protect_profile_attributes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Personne ne peut changer son PROPRE rôle ou statut actif, pas même un
  -- super-admin : ça doit toujours passer par un AUTRE super-administrateur.
  -- Objectif : rendre impossible de se retirer soi-même ses droits par
  -- erreur (ex: en s'attribuant une Section depuis son propre compte).
  if auth.uid() is not null and new.id = auth.uid()
     and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ou statut actif — demandez à un autre super-administrateur';
  end if;
  -- auth.uid() est NULL quand la requête ne passe pas par l'app (ex: SQL Editor
  -- Supabase, migrations) : ce contexte est déjà réservé à quelqu'un ayant accès
  -- au projet, donc on ne bloque pas. Le RLS empêche déjà toute requête anonyme
  -- côté app (auth.uid() NULL) d'atteindre cette table pour une écriture.
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
drop trigger if exists protect_profile_attributes on profiles;
create trigger protect_profile_attributes before update on profiles
  for each row execute procedure public.protect_profile_attributes();

alter table sections enable row level security;
drop policy if exists "own profile" on profiles;
drop policy if exists "profiles read" on profiles;
drop policy if exists "profiles own name" on profiles;
drop policy if exists "profiles admin write" on profiles;
create policy "profiles read" on profiles for select
  using (id = auth.uid() or public.is_super_admin());
create policy "profiles own name" on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin write" on profiles for update
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "sections read" on sections;
drop policy if exists "sections admin write" on sections;
create policy "sections read" on sections for select using (auth.role() = 'authenticated');
create policy "sections admin write" on sections for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "shared read/write programmes" on programmes;
drop policy if exists "shared read/write membres" on membres;
drop policy if exists "shared read/write sessions" on sessions;
drop policy if exists "shared read/write pointages" on pointages;
drop policy if exists "section programmes" on programmes;
drop policy if exists "section membres" on membres;
drop policy if exists "section sessions" on sessions;
drop policy if exists "section pointages" on pointages;
create policy "section programmes" on programmes for all
  using (public.can_access_section(section_id)) with check (public.can_access_section(section_id));
create policy "section membres" on membres for all
  using (public.can_access_section(section_id)) with check (public.can_access_section(section_id));
create policy "section sessions" on sessions for all
  using (public.can_access_section(section_id)) with check (public.can_access_section(section_id));
create policy "section pointages" on pointages for all
  using (public.can_access_section(section_id)) with check (public.can_access_section(section_id));

-- ============================================================
-- ÉTAPE FINALE (une seule fois) : désigner le premier super-administrateur.
-- Remplacez l'adresse ci-dessous par la vôtre (celle utilisée pour vous
-- inscrire dans l'app), puis exécutez le script.
-- - Si un compte avec cet email existe déjà : il est promu super-admin.
-- - Sinon (vous ne vous êtes pas encore inscrit, ou email différent) :
--   le tout premier compte créé est promu, en secours, s'il n'existe
--   encore aucun super-admin.
-- Ce bloc est sans danger à rejouer : une fois qu'un super-admin existe,
-- relancer le script ne change plus rien.
-- ============================================================
do $$
declare
  target_email text := 'votre-adresse@email.com'; -- <-- remplacez par votre email
begin
  if exists (select 1 from public.profiles where email = target_email) then
    update public.profiles
    set role = 'super_admin', active = true
    where email = target_email;
  elsif not exists (select 1 from public.profiles where role = 'super_admin') then
    update public.profiles
    set role = 'super_admin', active = true
    where id = (select id from public.profiles order by created_at asc limit 1);
  end if;
end $$;
