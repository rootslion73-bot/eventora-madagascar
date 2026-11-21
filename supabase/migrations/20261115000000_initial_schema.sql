begin;

create type public.app_role as enum ('customer', 'organizer', 'partner', 'admin');
create type public.partner_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.listing_status as enum ('draft', 'pending_review', 'published', 'rejected', 'archived');
create type public.service_kind as enum ('event', 'stay', 'trip');
create type public.order_status as enum ('pending', 'paid', 'cancelled', 'failed', 'refund_pending', 'refunded');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');
create type public.reservation_status as enum ('requested', 'pending', 'confirmed', 'cancelled', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  name text not null,
  description text,
  contact_email text,
  contact_phone text,
  website_url text,
  status public.partner_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  created_by uuid not null references auth.users (id) on delete restrict,
  title text not null,
  description text,
  venue_name text,
  city text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.listing_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_valid_dates check (ends_at is null or ends_at > starts_at)
);

create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  description text,
  price_mga bigint not null check (price_mga >= 0),
  capacity integer not null check (capacity >= 0),
  sold_count integer not null default 0 check (sold_count >= 0 and sold_count <= capacity),
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_types_valid_sales_dates check (
    sales_end_at is null or sales_start_at is null or sales_end_at > sales_start_at
  )
);

create table public.accommodations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  name text not null,
  description text,
  city text not null,
  address text,
  price_per_night_mga bigint not null check (price_per_night_mga >= 0),
  status public.listing_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accommodation_availability (
  id uuid primary key default gen_random_uuid(),
  accommodation_id uuid not null references public.accommodations (id) on delete cascade,
  available_from date not null,
  available_to date not null,
  units integer not null default 0 check (units >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accommodation_availability_valid_dates check (available_to > available_from)
);

create table public.transport_offers (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  origin text not null,
  destination text not null,
  departure_at timestamptz,
  estimated_arrival_at timestamptz,
  operator_name text not null,
  vehicle text,
  price_mga bigint not null check (price_mga >= 0),
  total_seats integer check (total_seats is null or total_seats >= 0),
  seats_sold integer not null default 0 check (seats_sold >= 0),
  manual_confirmation boolean not null default true,
  status public.listing_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_valid_arrival check (
    estimated_arrival_at is null or departure_at is null or estimated_arrival_at > departure_at
  ),
  constraint transport_valid_seat_count check (
    total_seats is null or seats_sold <= total_seats
  )
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  status public.order_status not null default 'pending',
  currency char(3) not null default 'MGA' check (currency = 'MGA'),
  gross_amount_mga bigint not null default 0 check (gross_amount_mga >= 0),
  platform_fee_mga bigint not null default 0 check (platform_fee_mga >= 0),
  provider_fee_mga bigint not null default 0 check (provider_fee_mga >= 0),
  partner_amount_mga bigint not null default 0 check (partner_amount_mga >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  partner_id uuid references public.partners (id) on delete set null,
  service public.service_kind not null,
  listing_id uuid not null,
  title_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price_mga bigint not null check (unit_price_mga >= 0),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  provider text not null,
  provider_reference text,
  idempotency_key text unique,
  amount_mga bigint not null check (amount_mga >= 0),
  status public.payment_status not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users (id) on delete restrict,
  partner_id uuid references public.partners (id) on delete set null,
  service public.service_kind not null,
  listing_id uuid not null,
  order_id uuid references public.orders (id) on delete set null,
  status public.reservation_status not null default 'requested',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_valid_dates check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  service public.service_kind not null,
  rate_basis_points integer not null default 0 check (rate_basis_points between 0 and 10000),
  fixed_fee_mga bigint not null default 0 check (fixed_fee_mga >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service)
);

create table public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  partner_id uuid references public.partners (id) on delete set null,
  gross_amount_mga bigint not null check (gross_amount_mga >= 0),
  platform_commission_mga bigint not null check (platform_commission_mga >= 0),
  provider_fee_mga bigint not null default 0 check (provider_fee_mga >= 0),
  partner_due_mga bigint not null check (partner_due_mga >= 0),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index user_roles_user_id_idx on public.user_roles (user_id);
create index partners_owner_status_idx on public.partners (owner_user_id, status);
create index events_partner_status_idx on public.events (partner_id, status);
create index events_city_starts_at_idx on public.events (city, starts_at) where status = 'published';
create index ticket_types_event_id_idx on public.ticket_types (event_id);
create index accommodations_partner_status_idx on public.accommodations (partner_id, status);
create index accommodations_city_idx on public.accommodations (city) where status = 'published';
create index accommodation_availability_dates_idx on public.accommodation_availability (accommodation_id, available_from, available_to);
create index transport_offers_route_idx on public.transport_offers (origin, destination, departure_at) where status = 'published';
create index orders_user_status_idx on public.orders (user_id, status, created_at desc);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_partner_id_idx on public.order_items (partner_id);
create index payments_order_id_idx on public.payments (order_id);
create index reservations_customer_idx on public.reservations (customer_id, created_at desc);
create index reservations_partner_idx on public.reservations (partner_id, status);
create index commission_ledger_partner_idx on public.commission_ledger (partner_id, created_at desc);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

create function public.owns_partner(target_partner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.partners
    where id = target_partner_id
      and owner_user_id = (select auth.uid())
  );
$$;

create function public.owns_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders
    where id = target_order_id
      and user_id = (select auth.uid())
  );
$$;

create function public.partner_has_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.order_items as item
    join public.partners as partner on partner.id = item.partner_id
    where item.order_id = target_order_id
      and partner.owner_user_id = (select auth.uid())
  );
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.protect_partner_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin()
    and (
      new.owner_user_id is distinct from old.owner_user_id
      or new.status is distinct from old.status
    )
  then
    raise exception 'Seul un administrateur peut modifier le propriétaire ou le statut du partenaire.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.protect_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin()
    and (
      (to_jsonb(new) ->> 'partner_id') is distinct from (to_jsonb(old) ->> 'partner_id')
      or (to_jsonb(new) ->> 'created_by') is distinct from (to_jsonb(old) ->> 'created_by')
      or (to_jsonb(new) ->> 'status') is distinct from (to_jsonb(old) ->> 'status')
    )
  then
    raise exception 'Seul un administrateur peut modifier le propriétaire, le créateur ou le statut de publication.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.protect_ticket_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin()
    and (
      new.event_id is distinct from old.event_id
      or new.sold_count is distinct from old.sold_count
    )
  then
    raise exception 'Le rattachement et le stock vendu ne peuvent être modifiés que par une opération autorisée.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.protect_transport_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin()
    and new.seats_sold is distinct from old.seats_sold
  then
    raise exception 'Le nombre de places vendues ne peut être modifié que par une opération autorisée.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger partners_set_updated_at before update on public.partners
  for each row execute function public.set_updated_at();
create trigger partners_protect_fields before update on public.partners
  for each row execute function public.protect_partner_fields();
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger events_protect_fields before update on public.events
  for each row execute function public.protect_listing_fields();
create trigger ticket_types_set_updated_at before update on public.ticket_types
  for each row execute function public.set_updated_at();
create trigger ticket_types_protect_stock before update on public.ticket_types
  for each row execute function public.protect_ticket_stock();
create trigger accommodations_set_updated_at before update on public.accommodations
  for each row execute function public.set_updated_at();
create trigger accommodations_protect_fields before update on public.accommodations
  for each row execute function public.protect_listing_fields();
create trigger accommodation_availability_set_updated_at before update on public.accommodation_availability
  for each row execute function public.set_updated_at();
create trigger transport_offers_set_updated_at before update on public.transport_offers
  for each row execute function public.set_updated_at();
create trigger transport_offers_protect_fields before update on public.transport_offers
  for each row execute function public.protect_listing_fields();
create trigger transport_offers_protect_stock before update on public.transport_offers
  for each row execute function public.protect_transport_stock();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger reservations_set_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();
create trigger commission_rules_set_updated_at before update on public.commission_rules
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.partners enable row level security;
alter table public.events enable row level security;
alter table public.ticket_types enable row level security;
alter table public.accommodations enable row level security;
alter table public.accommodation_availability enable row level security;
alter table public.transport_offers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.reservations enable row level security;
alter table public.commission_rules enable row level security;
alter table public.commission_ledger enable row level security;
alter table public.audit_logs enable row level security;

create policy "Profiles are visible to their owner or admins"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

create policy "Users can read their own roles"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Admins can manage roles"
  on public.user_roles for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Approved partners are public; owners and admins can read all"
  on public.partners for select to anon, authenticated
  using (status = 'approved' or owner_user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Authenticated users can submit a pending partner profile"
  on public.partners for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and status = 'pending');
create policy "Owners and admins can update partner details"
  on public.partners for update to authenticated
  using (owner_user_id = (select auth.uid()) or (select public.is_admin()))
  with check (owner_user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Admins can delete partner profiles"
  on public.partners for delete to authenticated
  using ((select public.is_admin()));

create policy "Published events are public; owners and admins can read all"
  on public.events for select to anon, authenticated
  using (
    (
      status = 'published'
      and exists (
        select 1 from public.partners as partner
        where partner.id = partner_id and partner.status = 'approved'
      )
    )
    or (select public.owns_partner(partner_id))
    or (select public.is_admin())
  );
create policy "Partner owners can create draft events"
  on public.events for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'draft'
    and (select public.owns_partner(partner_id))
  );
create policy "Partner owners and admins can update events"
  on public.events for update to authenticated
  using ((select public.owns_partner(partner_id)) or (select public.is_admin()))
  with check ((select public.owns_partner(partner_id)) or (select public.is_admin()));
create policy "Owners can delete draft events; admins can delete any event"
  on public.events for delete to authenticated
  using (
    ((select public.owns_partner(partner_id)) and status = 'draft')
    or (select public.is_admin())
  );

create policy "Ticket types follow parent event visibility"
  on public.ticket_types for select to anon, authenticated
  using (
    exists (
      select 1 from public.events as event
      where event.id = event_id
        and (
          event.status = 'published'
          or (select public.owns_partner(event.partner_id))
          or (select public.is_admin())
        )
    )
  );
create policy "Owners can add ticket types to draft events"
  on public.ticket_types for insert to authenticated
  with check (
    sold_count = 0
    and exists (
      select 1 from public.events as event
      where event.id = event_id
        and (
          ((select public.owns_partner(event.partner_id)) and event.status = 'draft')
          or (select public.is_admin())
        )
    )
  );
create policy "Owners can update ticket types for their draft events"
  on public.ticket_types for update to authenticated
  using (
    exists (
      select 1 from public.events as event
      where event.id = event_id
        and (
          ((select public.owns_partner(event.partner_id)) and event.status = 'draft')
          or (select public.is_admin())
        )
    )
  )
  with check (
    exists (
      select 1 from public.events as event
      where event.id = event_id
        and (
          ((select public.owns_partner(event.partner_id)) and event.status = 'draft')
          or (select public.is_admin())
        )
    )
  );
create policy "Owners can delete ticket types for their draft events"
  on public.ticket_types for delete to authenticated
  using (
    exists (
        select 1 from public.events as event
        where event.id = event_id
          and (
            ((select public.owns_partner(event.partner_id)) and event.status = 'draft')
            or (select public.is_admin())
          )
    )
  );

create policy "Published accommodations are public; owners and admins can read all"
  on public.accommodations for select to anon, authenticated
  using (
    (
      status = 'published'
      and exists (
        select 1 from public.partners as partner
        where partner.id = partner_id and partner.status = 'approved'
      )
    )
    or (select public.owns_partner(partner_id))
    or (select public.is_admin())
  );
create policy "Partner owners can create draft accommodations"
  on public.accommodations for insert to authenticated
  with check (
    status = 'draft'
    and (select public.owns_partner(partner_id))
  );
create policy "Partner owners and admins can update accommodations"
  on public.accommodations for update to authenticated
  using ((select public.owns_partner(partner_id)) or (select public.is_admin()))
  with check ((select public.owns_partner(partner_id)) or (select public.is_admin()));
create policy "Owners can delete draft accommodations; admins can delete any"
  on public.accommodations for delete to authenticated
  using (
    ((select public.owns_partner(partner_id)) and status = 'draft')
    or (select public.is_admin())
  );

create policy "Availability follows parent accommodation visibility"
  on public.accommodation_availability for select to anon, authenticated
  using (
    exists (
      select 1 from public.accommodations as accommodation
      where accommodation.id = accommodation_id
        and (
          accommodation.status = 'published'
          or (select public.owns_partner(accommodation.partner_id))
          or (select public.is_admin())
        )
    )
  );
create policy "Owners can manage availability for their accommodations"
  on public.accommodation_availability for all to authenticated
  using (
    exists (
      select 1 from public.accommodations as accommodation
      where accommodation.id = accommodation_id
        and (
          (select public.owns_partner(accommodation.partner_id))
          or (select public.is_admin())
        )
    )
  )
  with check (
    exists (
      select 1 from public.accommodations as accommodation
      where accommodation.id = accommodation_id
        and (
          (select public.owns_partner(accommodation.partner_id))
          or (select public.is_admin())
        )
    )
  );

create policy "Published transport offers are public; owners and admins can read all"
  on public.transport_offers for select to anon, authenticated
  using (
    (
      status = 'published'
      and exists (
        select 1 from public.partners as partner
        where partner.id = partner_id and partner.status = 'approved'
      )
    )
    or (select public.owns_partner(partner_id))
    or (select public.is_admin())
  );
create policy "Partner owners can create draft transport offers"
  on public.transport_offers for insert to authenticated
  with check (
    status = 'draft'
    and seats_sold = 0
    and (select public.owns_partner(partner_id))
  );
create policy "Partner owners and admins can update transport offers"
  on public.transport_offers for update to authenticated
  using ((select public.owns_partner(partner_id)) or (select public.is_admin()))
  with check ((select public.owns_partner(partner_id)) or (select public.is_admin()));
create policy "Owners can delete draft transport offers; admins can delete any"
  on public.transport_offers for delete to authenticated
  using (
    ((select public.owns_partner(partner_id)) and status = 'draft')
    or (select public.is_admin())
  );

create policy "Customers, relevant partners and admins can read orders"
  on public.orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.partner_has_order(id))
    or (select public.is_admin())
  );
create policy "Customers, relevant partners and admins can read order items"
  on public.order_items for select to authenticated
  using (
    (select public.owns_order(order_id))
    or (select public.partner_has_order(order_id))
    or (select public.is_admin())
  );
create policy "Customers and admins can read payment records"
  on public.payments for select to authenticated
  using (
    (select public.owns_order(order_id))
    or (select public.is_admin())
  );

create policy "Customers, relevant partners and admins can read reservations"
  on public.reservations for select to authenticated
  using (
    customer_id = (select auth.uid())
    or (partner_id is not null and (select public.owns_partner(partner_id)))
    or (select public.is_admin())
  );

create policy "Admins can manage commission rules"
  on public.commission_rules for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "Partners and admins can read their commission ledger"
  on public.commission_ledger for select to authenticated
  using (
    (partner_id is not null and (select public.owns_partner(partner_id)))
    or (select public.is_admin())
  );
create policy "Only admins can read audit logs"
  on public.audit_logs for select to authenticated
  using ((select public.is_admin()));

grant usage on schema public to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, phone) on public.profiles to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select on public.partners to anon, authenticated;
grant insert, update, delete on public.partners to authenticated;
grant select on public.events, public.ticket_types, public.accommodations,
  public.accommodation_availability, public.transport_offers to anon, authenticated;
grant insert, update, delete on public.events, public.ticket_types,
  public.accommodations, public.accommodation_availability,
  public.transport_offers to authenticated;
grant select on public.orders, public.order_items, public.payments,
  public.reservations, public.commission_rules, public.commission_ledger,
  public.audit_logs to authenticated;
grant insert, update, delete on public.commission_rules to authenticated;
grant all on public.profiles, public.user_roles, public.partners, public.events,
  public.ticket_types, public.accommodations, public.accommodation_availability,
  public.transport_offers, public.orders, public.order_items, public.payments,
  public.reservations, public.commission_rules, public.commission_ledger,
  public.audit_logs to service_role;
grant usage, select on sequence public.audit_logs_id_seq to service_role;

revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.owns_partner(uuid) from public, anon, authenticated;
revoke all on function public.owns_order(uuid) from public, anon, authenticated;
revoke all on function public.partner_has_order(uuid) from public, anon, authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.owns_partner(uuid) to anon, authenticated;
grant execute on function public.owns_order(uuid) to authenticated;
grant execute on function public.partner_has_order(uuid) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.protect_partner_fields() from public, anon, authenticated;
revoke all on function public.protect_listing_fields() from public, anon, authenticated;
revoke all on function public.protect_ticket_stock() from public, anon, authenticated;
revoke all on function public.protect_transport_stock() from public, anon, authenticated;

commit;
