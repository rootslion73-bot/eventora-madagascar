begin;

create type public.ticket_status as enum ('issued', 'used', 'voided');

alter table public.events
  add column category text not null default 'Événement',
  add column image_url text;

alter table public.ticket_types
  add column reserved_count integer not null default 0;
alter table public.ticket_types
  drop constraint if exists ticket_types_sold_count_check;
alter table public.ticket_types
  add constraint ticket_types_valid_inventory
  check (
    sold_count >= 0
    and reserved_count >= 0
    and sold_count::bigint + reserved_count::bigint <= capacity
  );
alter table public.orders
  add column hold_expires_at timestamptz not null default now() + interval '15 minutes';
alter table public.order_items
  add column ticket_type_id uuid references public.ticket_types (id) on delete restrict;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  ticket_number integer not null check (ticket_number > 0),
  qr_code uuid not null unique default gen_random_uuid(),
  status public.ticket_status not null default 'issued',
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (order_item_id, ticket_number),
  constraint ticket_check_in_state check (
    (status = 'used' and checked_in_at is not null and checked_in_by is not null)
    or (status <> 'used' and checked_in_at is null and checked_in_by is null)
  )
);

create index ticket_types_stock_idx on public.ticket_types (event_id, capacity, sold_count, reserved_count);
create index orders_pending_expiry_idx on public.orders (hold_expires_at)
  where status = 'pending';
create index order_items_ticket_type_idx on public.order_items (ticket_type_id);
create index tickets_owner_created_idx on public.tickets (owner_user_id, created_at desc);
create index tickets_order_item_idx on public.tickets (order_item_id);
create unique index payments_provider_reference_uidx
  on public.payments (provider, provider_reference)
  where provider_reference is not null;

create or replace function public.protect_ticket_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role')
    and not public.is_admin()
    and (
      new.event_id is distinct from old.event_id
      or new.sold_count is distinct from old.sold_count
      or new.reserved_count is distinct from old.reserved_count
    )
  then
    raise exception 'Le rattachement et le stock réservé ou vendu ne peuvent être modifiés que par une opération autorisée.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.release_order_ticket_holds(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  held_item record;
begin
  for held_item in
    select ticket_type_id, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = target_order_id
      and ticket_type_id is not null
    group by ticket_type_id
    order by ticket_type_id
  loop
    update public.ticket_types
    set reserved_count = reserved_count - held_item.quantity
    where id = held_item.ticket_type_id
      and reserved_count >= held_item.quantity;

    if not found then
      raise exception 'Le stock réservé de la commande % est incohérent.', target_order_id
        using errcode = '23514';
    end if;
  end loop;
end;
$$;

create function public.release_expired_ticket_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_order record;
  released_count integer := 0;
begin
  for expired_order in
    select id
    from public.orders
    where status = 'pending'
      and hold_expires_at <= now()
    order by hold_expires_at
    for update skip locked
  loop
    perform public.release_order_ticket_holds(expired_order.id);

    update public.orders
    set status = 'cancelled'
    where id = expired_order.id
      and status = 'pending';

    released_count := released_count + 1;
  end loop;

  return released_count;
end;
$$;

create function public.create_pending_ticket_order(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_item record;
  ticket_type record;
  created_order_id uuid;
  order_expiry timestamptz := now() + interval '15 minutes';
  order_total bigint := 0;
  total_quantity integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Connectez-vous avant de commander.'
      using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'La liste de billets est invalide.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    raise exception 'Une commande doit contenir de 1 à 20 lignes de billets.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as input_item(value)
    where jsonb_typeof(input_item.value) <> 'object'
      or coalesce(jsonb_typeof(input_item.value -> 'ticket_type_id'), '') <> 'string'
      or coalesce(input_item.value ->> 'ticket_type_id', '') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      or coalesce(input_item.value ->> 'quantity', '') !~ '^[1-9][0-9]{0,1}$'
  ) then
    raise exception 'Chaque ligne doit contenir un identifiant de billet et une quantité entière positive.'
      using errcode = '22023';
  end if;

  select sum((input_item.value ->> 'quantity')::integer)::integer
  into total_quantity
  from jsonb_array_elements(p_items) as input_item(value);

  if total_quantity > 20 then
    raise exception 'La commande dépasse la limite de 20 billets.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(12045, hashtext((select auth.uid())::text));
  perform public.release_expired_ticket_holds();

  if total_quantity + coalesce((
    select sum(order_item.quantity)::integer
    from public.orders as active_order
    join public.order_items as order_item on order_item.order_id = active_order.id
    where active_order.user_id = (select auth.uid())
      and active_order.status = 'pending'
      and active_order.hold_expires_at > now()
  ), 0) > 20 then
    raise exception 'Vous avez déjà 20 billets en attente. Terminez ou laissez expirer une commande avant d’en créer une autre.'
      using errcode = 'P0001';
  end if;

  insert into public.orders (
    user_id,
    status,
    gross_amount_mga,
    platform_fee_mga,
    provider_fee_mga,
    partner_amount_mga,
    hold_expires_at
  )
  values (
    (select auth.uid()),
    'pending',
    0,
    0,
    0,
    0,
    order_expiry
  )
  returning id into created_order_id;

  for requested_item in
    select
      (input_item.value ->> 'ticket_type_id')::uuid as ticket_type_id,
      sum((input_item.value ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as input_item(value)
    group by (input_item.value ->> 'ticket_type_id')::uuid
    order by (input_item.value ->> 'ticket_type_id')::uuid
  loop
    select
      ticket.id,
      ticket.event_id,
      ticket.name as ticket_name,
      ticket.price_mga,
      ticket.capacity,
      ticket.sold_count,
      ticket.reserved_count,
      ticket.sales_start_at,
      ticket.sales_end_at,
      event.title as event_title,
      event.partner_id
    into ticket_type
    from public.ticket_types as ticket
    join public.events as event on event.id = ticket.event_id
    join public.partners as partner on partner.id = event.partner_id
    where ticket.id = requested_item.ticket_type_id
      and event.status = 'published'
      and partner.status = 'approved'
    for update of ticket;

    if not found then
      raise exception 'Une catégorie de billet est introuvable ou indisponible.'
        using errcode = 'P0002';
    end if;

    if (ticket_type.sales_start_at is not null and ticket_type.sales_start_at > now())
      or (ticket_type.sales_end_at is not null and ticket_type.sales_end_at <= now())
    then
      raise exception 'La vente de la catégorie "%" n’est pas ouverte.', ticket_type.ticket_name
        using errcode = 'P0001';
    end if;

    if ticket_type.capacity - ticket_type.sold_count - ticket_type.reserved_count
      < requested_item.quantity
    then
      raise exception 'Le stock disponible pour "%" est insuffisant.', ticket_type.ticket_name
        using errcode = 'P0001';
    end if;

    update public.ticket_types
    set reserved_count = reserved_count + requested_item.quantity
    where id = ticket_type.id;

    insert into public.order_items (
      order_id,
      partner_id,
      service,
      listing_id,
      ticket_type_id,
      title_snapshot,
      quantity,
      unit_price_mga
    )
    values (
      created_order_id,
      ticket_type.partner_id,
      'event',
      ticket_type.event_id,
      ticket_type.id,
      ticket_type.event_title || ' — ' || ticket_type.ticket_name,
      requested_item.quantity,
      ticket_type.price_mga
    );

    order_total := order_total
      + (ticket_type.price_mga * requested_item.quantity);
  end loop;

  update public.orders
  set gross_amount_mga = order_total,
      partner_amount_mga = order_total
  where id = created_order_id;

  return jsonb_build_object(
    'order_id', created_order_id,
    'status', 'pending',
    'hold_expires_at', order_expiry,
    'total_mga', order_total
  );
end;
$$;

create function public.confirm_paid_ticket_order(
  p_order_id uuid,
  p_provider text,
  p_provider_reference text,
  p_verified_amount_mga bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_order public.orders%rowtype;
  payment_id uuid;
  item record;
  ticket_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  if p_provider is null or length(trim(p_provider)) = 0
    or p_provider_reference is null or length(trim(p_provider_reference)) = 0
    or p_verified_amount_mga is null
    or p_verified_amount_mga < 0
  then
    raise exception 'Les informations vérifiées du paiement sont invalides.'
      using errcode = '22023';
  end if;

  perform public.release_expired_ticket_holds();

  select *
  into ticket_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Commande introuvable.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.payments
    where provider = trim(p_provider)
      and provider_reference = trim(p_provider_reference)
  ) then
    if exists (
      select 1 from public.payments
      where order_id = p_order_id
        and provider = trim(p_provider)
        and provider_reference = trim(p_provider_reference)
        and status = 'succeeded'
        and verified_at is not null
    )
    then
      if ticket_order.status = 'paid' then
        select count(*)::integer into ticket_count
        from public.tickets as ticket
        join public.order_items as item on item.id = ticket.order_item_id
        where item.order_id = p_order_id;
      end if;
      return jsonb_build_object(
        'order_id', p_order_id,
        'status', ticket_order.status,
        'tickets_issued', ticket_count,
        'duplicate', true,
        'refund_required', ticket_order.status = 'refund_pending'
      );
    end if;

    raise exception 'Cette référence de paiement a déjà été traitée.'
      using errcode = '23505';
  end if;

  if ticket_order.status = 'paid' then
    insert into public.payments (
      order_id, provider, provider_reference,
      amount_mga, status, verified_at
    )
    values (
      p_order_id,
      trim(p_provider),
      trim(p_provider_reference),
      p_verified_amount_mga,
      'succeeded',
      now()
    );

    return jsonb_build_object(
      'order_id', p_order_id,
      'status', 'paid',
      'tickets_issued', 0,
      'refund_required', true,
      'reason', 'duplicate_payment'
    );
  end if;

  if ticket_order.status <> 'pending' then
    insert into public.payments (
      order_id, provider, provider_reference,
      amount_mga, status, verified_at
    )
    values (
      p_order_id,
      trim(p_provider),
      trim(p_provider_reference),
      p_verified_amount_mga,
      'succeeded',
      now()
    );

    update public.orders
    set status = 'refund_pending'
    where id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'status', 'refund_pending',
      'tickets_issued', 0,
      'refund_required', true,
      'reason', 'order_no_longer_pending'
    );
  end if;

  if ticket_order.hold_expires_at <= now()
    or p_verified_amount_mga <> ticket_order.gross_amount_mga
  then
    perform public.release_order_ticket_holds(p_order_id);

    insert into public.payments (
      order_id, provider, provider_reference,
      amount_mga, status, verified_at
    )
    values (
      p_order_id,
      trim(p_provider),
      trim(p_provider_reference),
      p_verified_amount_mga,
      'succeeded',
      now()
    );

    update public.orders
    set status = 'refund_pending'
    where id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'status', 'refund_pending',
      'tickets_issued', 0,
      'refund_required', true,
      'reason', case
        when ticket_order.hold_expires_at <= now() then 'hold_expired'
        else 'amount_mismatch'
      end
    );
  end if;

  insert into public.payments (
    order_id, provider, provider_reference,
    amount_mga, status, verified_at
  )
  values (
    p_order_id,
    trim(p_provider),
    trim(p_provider_reference),
    p_verified_amount_mga,
    'succeeded',
    now()
  )
  returning id into payment_id;

  update public.orders
  set status = 'paid'
  where id = p_order_id;

  for item in
    select id as order_item_id, ticket_type_id, quantity
    from public.order_items
    where order_id = p_order_id
      and ticket_type_id is not null
    order by ticket_type_id, id
  loop
    update public.ticket_types
    set reserved_count = reserved_count - item.quantity,
        sold_count = sold_count + item.quantity
    where id = item.ticket_type_id
      and reserved_count >= item.quantity;

    if not found then
      raise exception 'Le stock réservé de la commande % est incohérent.', p_order_id
        using errcode = '23514';
    end if;

    insert into public.tickets (
      order_item_id,
      ticket_type_id,
      owner_user_id,
      ticket_number
    )
    select
      order_item.id,
      item.ticket_type_id,
      ticket_order.user_id,
      generated.ticket_number
    from public.order_items as order_item
    cross join generate_series(1, item.quantity) as generated(ticket_number)
    where order_item.id = item.order_item_id;

    ticket_count := ticket_count + item.quantity;
  end loop;

  return jsonb_build_object(
    'order_id', p_order_id,
    'status', 'paid',
    'payment_id', payment_id,
    'tickets_issued', ticket_count,
    'refund_required', false
  );
end;
$$;

create function public.validate_event_ticket(p_qr_code uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scanned_ticket record;
begin
  if (select auth.uid()) is null then
    raise exception 'Connectez-vous avec un compte organisateur pour valider un billet.'
      using errcode = '42501';
  end if;

  select
    ticket.id,
    ticket.status,
    ticket.checked_in_at,
    ticket.owner_user_id,
    event.title as event_title,
    ticket_type.name as ticket_type_name,
    payment_order.status as order_status,
    partner.owner_user_id as partner_owner_id
  into scanned_ticket
  from public.tickets as ticket
  join public.order_items as order_item on order_item.id = ticket.order_item_id
  join public.orders as payment_order on payment_order.id = order_item.order_id
  join public.events as event on event.id = order_item.listing_id
  join public.partners as partner on partner.id = event.partner_id
  join public.ticket_types as ticket_type on ticket_type.id = ticket.ticket_type_id
  where ticket.qr_code = p_qr_code
    and (
      partner.owner_user_id = (select auth.uid())
      or (select public.is_admin())
    )
  for update of ticket;

  if not found then
    return jsonb_build_object(
      'valid', false,
      'reason', 'invalid_or_unauthorized'
    );
  end if;

  if scanned_ticket.order_status <> 'paid' then
    return jsonb_build_object('valid', false, 'reason', 'order_not_paid');
  end if;

  if scanned_ticket.status = 'used' then
    return jsonb_build_object(
      'valid', false,
      'reason', 'already_used',
      'event_title', scanned_ticket.event_title,
      'ticket_type', scanned_ticket.ticket_type_name,
      'checked_in_at', scanned_ticket.checked_in_at
    );
  end if;

  if scanned_ticket.status <> 'issued' then
    return jsonb_build_object('valid', false, 'reason', 'ticket_voided');
  end if;

  update public.tickets
  set status = 'used',
      checked_in_at = now(),
      checked_in_by = (select auth.uid())
  where id = scanned_ticket.id;

  return jsonb_build_object(
    'valid', true,
    'event_title', scanned_ticket.event_title,
    'ticket_type', scanned_ticket.ticket_type_name,
    'checked_in_at', now()
  );
end;
$$;

drop policy "Owners can add ticket types to draft events" on public.ticket_types;
create policy "Owners can add ticket types to draft events"
  on public.ticket_types for insert to authenticated
  with check (
    sold_count = 0
    and reserved_count = 0
    and exists (
      select 1 from public.events as event
      where event.id = event_id
        and (
          ((select public.owns_partner(event.partner_id)) and event.status = 'draft')
          or (select public.is_admin())
        )
    )
  );

alter table public.tickets enable row level security;
create policy "Customers can read their paid tickets"
  on public.tickets for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    and exists (
      select 1
      from public.order_items as order_item
      join public.orders as ticket_order on ticket_order.id = order_item.order_id
      where order_item.id = order_item_id
        and ticket_order.status = 'paid'
    )
  );

grant select on public.tickets to authenticated;
revoke insert, update, delete on public.tickets from anon, authenticated;
grant all on public.tickets to service_role;

revoke all on function public.release_order_ticket_holds(uuid) from public, anon, authenticated;
revoke all on function public.release_expired_ticket_holds() from public, anon, authenticated;
revoke all on function public.create_pending_ticket_order(jsonb) from public, anon, service_role;
revoke all on function public.confirm_paid_ticket_order(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.validate_event_ticket(uuid) from public, anon;

grant execute on function public.create_pending_ticket_order(jsonb) to authenticated;
grant execute on function public.release_expired_ticket_holds() to authenticated, service_role;
grant execute on function public.confirm_paid_ticket_order(uuid, text, text, bigint) to service_role;
grant execute on function public.validate_event_ticket(uuid) to authenticated;

commit;
