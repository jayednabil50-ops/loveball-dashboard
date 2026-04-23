-- Add SKU/Code support to products and vector search payloads.

alter table public.products
  add column if not exists sku text;

create index if not exists idx_products_sku
  on public.products (sku);

create or replace function public.mark_product_embed_stale()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.embed_status := 'pending';
    new.embed_error := null;
    return new;
  end if;

  if (
    coalesce(new.name, '')        is distinct from coalesce(old.name, '') or
    coalesce(new.sku, '')         is distinct from coalesce(old.sku, '') or
    coalesce(new.category, '')    is distinct from coalesce(old.category, '') or
    coalesce(new.includes, '')    is distinct from coalesce(old.includes, '') or
    coalesce(new.material, '')    is distinct from coalesce(old.material, '') or
    coalesce(new.capacity, '')    is distinct from coalesce(old.capacity, '') or
    coalesce(new.burner_size, '') is distinct from coalesce(old.burner_size, '') or
    coalesce(new.height, '')      is distinct from coalesce(old.height, '') or
    coalesce(new.fan_type, '')    is distinct from coalesce(old.fan_type, '')
  ) then
    new.embed_status := 'pending';
    new.embed_error := null;
  end if;

  return new;
end;
$$;

create or replace function public.match_products(
  query_embedding vector(1536),
  match_count int default 5,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  with ranked as (
    select
      p.id,
      trim(
        concat_ws(
          E'\n',
          concat('Name: ', coalesce(p.name, '')),
          case when p.sku is not null then concat('SKU: ', p.sku) end,
          case when p.category is not null then concat('Category: ', p.category) end,
          case when p.price is not null then concat('Price: ', p.price) end,
          case when p.capacity is not null then concat('Capacity: ', p.capacity) end,
          case when p.burner_size is not null then concat('Burner size: ', p.burner_size) end,
          case when p.height is not null then concat('Height: ', p.height) end,
          case when p.material is not null then concat('Material: ', p.material) end,
          case when p.fan_type is not null then concat('Fan type: ', p.fan_type) end,
          case when p.includes is not null then concat('Includes: ', p.includes) end
        )
      ) as content,
      jsonb_strip_nulls(
        jsonb_build_object(
          'source', 'product',
          'product_id', p.id,
          'name', p.name,
          'sku', p.sku,
          'category', p.category,
          'price', p.price,
          'capacity', p.capacity,
          'burner_size', p.burner_size,
          'height', p.height,
          'includes', p.includes,
          'material', p.material,
          'fan_type', p.fan_type,
          'image_url', p.image_url,
          'video_url', p.video_url
        )
      ) as metadata,
      1 - (p.embedding <=> query_embedding) as similarity
    from public.products p
    where p.embedding is not null
  )
  select
    r.id,
    r.content,
    r.metadata,
    r.similarity
  from ranked r
  where coalesce(filter, '{}'::jsonb) = '{}'::jsonb
     or r.metadata @> coalesce(filter, '{}'::jsonb)
  order by r.similarity desc
  limit greatest(coalesce(match_count, 5), 1);
$$;

grant execute on function public.match_products(vector, int, jsonb) to anon, authenticated;
