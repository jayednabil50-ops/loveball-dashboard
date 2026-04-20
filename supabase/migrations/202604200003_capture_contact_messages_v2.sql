-- v2: reliable inbound capture from conversation updates
-- - does not rely on unread increment (many flows always write unread_count = 1)
-- - converts nearby misclassified `sender=user` inbound rows to `sender=contact`
-- - keeps bot echoes out of customer side

create or replace function public.capture_contact_message_from_conversation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_last_message text := trim(coalesce(new.last_message, ''));
  v_last_time timestamptz := coalesce(new.last_message_time, now());
  v_last_message_key text := lower(trim(regexp_replace(v_last_message, '[^a-zA-Z0-9 ]', '', 'g')));
  v_message_changed boolean := true;
  v_fixed_user_message_id uuid;
begin
  if tg_op = 'UPDATE' then
    v_message_changed :=
      trim(coalesce(new.last_message, '')) is distinct from trim(coalesce(old.last_message, ''))
      or coalesce(new.last_message_time, 'epoch'::timestamptz) is distinct from coalesce(old.last_message_time, 'epoch'::timestamptz);
  end if;

  if not v_message_changed then
    return new;
  end if;

  -- inbound/customer updates are expected to keep unread > 0
  if coalesce(new.unread_count, 0) <= 0 then
    return new;
  end if;

  if v_last_message = '' then
    return new;
  end if;

  -- media placeholders are inserted by dedicated flows
  if v_last_message_key in ('image', 'voice message', 'carousel') then
    return new;
  end if;

  -- already captured
  if exists (
    select 1
    from public.messages m
    where m.conversation_id = new.id
      and m.sender = 'contact'
      and trim(coalesce(m.content, '')) = v_last_message
      and m.created_at between v_last_time - interval '3 minutes' and v_last_time + interval '2 minutes'
  ) then
    return new;
  end if;

  -- bot-side message with same content nearby -> likely outbound echo/update
  if exists (
    select 1
    from public.messages m
    where m.conversation_id = new.id
      and (
        m.sender = 'ai'
        or coalesce(m.is_from_bot, false) = true
      )
      and trim(coalesce(m.content, '')) = v_last_message
      and m.created_at between v_last_time - interval '3 minutes' and v_last_time + interval '2 minutes'
  ) then
    return new;
  end if;

  -- if workflow inserted inbound as sender=user, normalize that row
  update public.messages m
  set
    sender = 'contact',
    message_type = coalesce(nullif(m.message_type, ''), 'text'),
    facebook_id = coalesce(m.facebook_id, new.facebook_id),
    contact_name = coalesce(m.contact_name, new.contact_name)
  where m.id = (
    select m2.id
    from public.messages m2
    where m2.conversation_id = new.id
      and m2.sender = 'user'
      and coalesce(m2.is_from_bot, false) = false
      and trim(coalesce(m2.content, '')) = v_last_message
      and m2.created_at between v_last_time - interval '3 minutes' and v_last_time + interval '2 minutes'
    order by m2.created_at desc
    limit 1
  )
  returning m.id into v_fixed_user_message_id;

  if v_fixed_user_message_id is not null then
    return new;
  end if;

  insert into public.messages (
    conversation_id,
    facebook_id,
    contact_name,
    content,
    sender,
    message_type,
    created_at
  )
  values (
    new.id,
    new.facebook_id,
    new.contact_name,
    v_last_message,
    'contact',
    'text',
    v_last_time
  );

  return new;
end;
$$;

-- one-time backfill of clearly misclassified latest inbound rows
update public.messages m
set
  sender = 'contact',
  message_type = coalesce(nullif(m.message_type, ''), 'text')
from public.conversations c
where m.conversation_id = c.id
  and m.sender = 'user'
  and coalesce(m.is_from_bot, false) = false
  and m.facebook_id is not null
  and trim(coalesce(m.content, '')) = trim(coalesce(c.last_message, ''))
  and m.created_at between c.last_message_time - interval '10 minutes' and c.last_message_time + interval '10 minutes';
