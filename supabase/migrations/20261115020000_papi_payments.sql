begin;

alter table public.orders
  alter column hold_expires_at set default now() + interval '60 minutes';

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  provider text not null default 'Papi' check (provider = 'Papi'),
  merchant_reference text not null unique,
  notification_token text,
  checkout_url text,
  link_expires_at timestamptz,
  provider_reference text unique,
  amount_mga bigint not null check (amount_mga >= 300),
  currency char(3) not null default 'MGA' check (currency = 'MGA'),
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intent_checkout_state check (
    (checkout_url is null and notification_token is null and link_expires_at is null)
    or (checkout_url is not null and notification_token is not null and link_expires_at is not null)
  )
);

alter table public.payment_intents enable row level security;
revoke all on public.payment_intents from public, anon, authenticated;
grant all on public.payment_intents to service_role;

create index payment_intents_order_status_idx
  on public.payment_intents (order_id, status);

create or replace function public.create_pending_ticket_order(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_item record;
  ticket_type record;
  created_order_id uuid;
  order_expiry timestamptz := now() + interval '60 minutes';
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

create function public.prepare_papi_payment(p_order_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_order public.orders%rowtype;
  intent public.payment_intents%rowtype;
  intent_id uuid := gen_random_uuid();
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  if p_order_id is null or p_customer_id is null then
    raise exception 'La commande ou le client est invalide.'
      using errcode = '22023';
  end if;

  perform public.release_expired_ticket_holds();
  select * into ticket_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or ticket_order.user_id <> p_customer_id then
    raise exception 'Commande introuvable.'
      using errcode = 'P0002';
  end if;

  if ticket_order.status <> 'pending'
    or ticket_order.hold_expires_at <= now()
  then
    raise exception 'La commande n’est plus payable ; vérifiez son statut dans votre compte.'
      using errcode = 'P0001';
  end if;

  if ticket_order.gross_amount_mga < 300 then
    raise exception 'Le montant minimum accepté par Papi est de 300 MGA.'
      using errcode = '22023';
  end if;

  select * into intent
  from public.payment_intents
  where order_id = p_order_id
  for update;

  if found then
    if intent.status = 'succeeded' then
      raise exception 'Cette commande a déjà été payée.'
        using errcode = 'P0001';
    end if;

    return jsonb_build_object(
      'payment_id', intent.id,
      'merchant_reference', intent.merchant_reference,
      'amount_mga', intent.amount_mga,
      'checkout_url', intent.checkout_url,
      'link_expires_at', intent.link_expires_at
    );
  end if;

  insert into public.payment_intents (
    id,
    order_id,
    customer_id,
    merchant_reference,
    amount_mga
  )
  values (
    intent_id,
    p_order_id,
    p_customer_id,
    'EVENTORA-' || replace(intent_id::text, '-', ''),
    ticket_order.gross_amount_mga
  )
  returning * into intent;

  return jsonb_build_object(
    'payment_id', intent.id,
    'merchant_reference', intent.merchant_reference,
    'amount_mga', intent.amount_mga,
    'checkout_url', null,
    'link_expires_at', null
  );
end;
$$;

create function public.store_papi_checkout_link(
  p_payment_id uuid,
  p_customer_id uuid,
  p_checkout_url text,
  p_notification_token text,
  p_link_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.payment_intents%rowtype;
  ticket_order public.orders%rowtype;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  if p_checkout_url is null
    or p_checkout_url !~ '^https://(payment-form|link)\.papi\.mg/'
    or p_notification_token is null
    or length(p_notification_token) < 16
    or p_link_expires_at is null
    or p_link_expires_at <= now()
  then
    raise exception 'La réponse du prestataire est invalide.'
      using errcode = '22023';
  end if;

  select * into intent
  from public.payment_intents
  where id = p_payment_id
    and customer_id = p_customer_id
  for update;

  if not found then
    raise exception 'Intention de paiement introuvable.'
      using errcode = 'P0002';
  end if;

  select * into ticket_order
  from public.orders
  where id = intent.order_id
  for update;

  if ticket_order.status <> 'pending'
    or ticket_order.hold_expires_at <= now()
    or intent.status = 'succeeded'
  then
    raise exception 'La réservation du stock a expiré ou la commande a déjà été réglée.'
      using errcode = 'P0001';
  end if;

  update public.payment_intents
  set checkout_url = p_checkout_url,
      notification_token = p_notification_token,
      link_expires_at = p_link_expires_at,
      updated_at = now()
  where id = p_payment_id;

  return jsonb_build_object(
    'checkout_url', p_checkout_url,
    'link_expires_at', p_link_expires_at
  );
end;
$$;

create function public.get_papi_payment_intent(
  p_order_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.payment_intents%rowtype;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  perform public.release_expired_ticket_holds();

  select * into intent
  from public.payment_intents
  where order_id = p_order_id
    and customer_id = p_customer_id;

  if not found then
    raise exception 'Intention de paiement introuvable.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'payment_id', intent.id,
    'order_id', intent.order_id,
    'merchant_reference', intent.merchant_reference,
    'notification_token', intent.notification_token,
    'provider_reference', intent.provider_reference,
    'amount_mga', intent.amount_mga,
    'currency', intent.currency,
    'checkout_url', intent.checkout_url,
    'status', intent.status
  );
end;
$$;

create function public.process_papi_notification(
  p_merchant_reference text,
  p_notification_token text,
  p_payment_status text,
  p_provider_payment_reference text,
  p_amount_mga bigint,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.payment_intents%rowtype;
  order_result jsonb;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  if p_merchant_reference is null
    or p_notification_token is null
    or p_payment_status is null
    or p_payment_status not in ('SUCCESS', 'FAILED', 'PENDING')
    or p_amount_mga is null
    or p_currency is null
    or p_currency <> 'MGA'
    or (p_payment_status = 'SUCCESS' and coalesce(p_provider_payment_reference, '') = '')
  then
    raise exception 'Notification Papi invalide.'
      using errcode = '22023';
  end if;

  select * into intent
  from public.payment_intents
  where merchant_reference = p_merchant_reference
  for update;

  if not found
    or intent.notification_token is null
    or intent.notification_token <> p_notification_token
  then
    raise exception 'Référence ou jeton de notification inconnu.'
      using errcode = '42501';
  end if;

  if p_amount_mga <> intent.amount_mga then
    raise exception 'Le montant notifié ne correspond pas au montant attendu.'
      using errcode = '22023';
  end if;

  if intent.status = 'succeeded' then
    if p_payment_status = 'SUCCESS'
      and intent.provider_reference is distinct from p_provider_payment_reference
    then
      order_result := public.confirm_paid_ticket_order(
        intent.order_id,
        'Papi',
        p_provider_payment_reference,
        p_amount_mga
      );

      return order_result || jsonb_build_object(
        'duplicate', false,
        'additional_payment', true
      );
    end if;

    return jsonb_build_object(
      'status', 'succeeded',
      'duplicate', true,
      'order_id', intent.order_id
    );
  end if;

  if p_payment_status = 'SUCCESS' then
    order_result := public.confirm_paid_ticket_order(
      intent.order_id,
      'Papi',
      p_provider_payment_reference,
      p_amount_mga
    );

    update public.payment_intents
    set status = 'succeeded',
        provider_reference = p_provider_payment_reference,
        updated_at = now()
    where id = intent.id;

    return order_result || jsonb_build_object('duplicate', false);
  end if;

  update public.payment_intents
  set status = case
        when p_payment_status = 'FAILED' then 'failed'::public.payment_status
        else 'pending'::public.payment_status
      end,
      updated_at = now()
  where id = intent.id;

  return jsonb_build_object(
    'status', lower(p_payment_status),
    'order_id', intent.order_id,
    'duplicate', false
  );
end;
$$;

revoke all on function public.prepare_papi_payment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.store_papi_checkout_link(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_papi_payment_intent(uuid, uuid) from public, anon, authenticated;
revoke all on function public.process_papi_notification(text, text, text, text, bigint, text) from public, anon, authenticated;

grant execute on function public.prepare_papi_payment(uuid, uuid) to service_role;
grant execute on function public.store_papi_checkout_link(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.get_papi_payment_intent(uuid, uuid) to service_role;
grant execute on function public.process_papi_notification(text, text, text, text, bigint, text) to service_role;

commit;
