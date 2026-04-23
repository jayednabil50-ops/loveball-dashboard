// Embed a single product (or all pending products) using the OpenAI-compatible
// API key + base URL stored in app_settings.
//
// Body:
//   { product_id: string }                -> embed one product
//   { all_pending: true, limit?: number } -> embed all pending products (batch)
//
// Returns: { ok, embedded: number, errors: [{id, error}] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const EMBED_MODEL = 'text-embedding-3-small'

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function buildProductText(p: any): string {
  const parts = [
    p.name && `Name: ${p.name}`,
    p.sku && `SKU: ${p.sku}`,
    p.category && `Category: ${p.category}`,
    p.price != null && `Price: ${p.price}`,
    p.capacity && `Capacity: ${p.capacity}`,
    p.burner_size && `Burner size: ${p.burner_size}`,
    p.height && `Height: ${p.height}`,
    p.material && `Material: ${p.material}`,
    p.fan_type && `Fan type: ${p.fan_type}`,
    p.includes && `Includes: ${p.includes}`,
  ].filter(Boolean)
  return parts.join('\n')
}

async function getProviderConfig(supabase: any) {
  const envApiKey = (Deno.env.get('OPENAI_API_KEY') || '').trim()
  const envBaseUrl = (Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1')
    .trim()
    .replace(/\/$/, '')
  if (envApiKey) {
    return { apiKey: envApiKey, baseUrl: envBaseUrl }
  }

  const { data, error } = await supabase
    .from('app_settings')
    .select('key,value')
    .in('key', ['openai_api_key', 'openai_base_url'])
  if (error) throw new Error(`Failed to read app_settings: ${error.message}`)
  const map = Object.fromEntries((data || []).map((r: any) => [r.key, r.value]))
  const apiKey = (map.openai_api_key || '').toString().trim()
  const baseUrl = (map.openai_base_url || 'https://api.openai.com/v1').toString().trim().replace(/\/$/, '')
  if (!apiKey) throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY secret or app_settings.openai_api_key.')
  return { apiKey, baseUrl }
}

async function embedText(text: string, apiKey: string, baseUrl: string): Promise<number[]> {
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Embedding API ${res.status}: ${errText.slice(0, 300)}`)
  }
  const json = await res.json()
  const vec = json?.data?.[0]?.embedding
  if (!Array.isArray(vec)) throw new Error('Invalid embedding response format')
  return vec
}

async function embedOneProduct(
  supabase: any,
  product: any,
  ensureProvider: () => Promise<{ apiKey: string; baseUrl: string }>,
) {
  const text = buildProductText(product)
  if (!text.trim()) {
    await supabase.from('products').update({
      embed_status: 'error', embed_error: 'No content to embed', embedded_at: new Date().toISOString(),
    }).eq('id', product.id)
    throw new Error('Empty product content')
  }

  const inputHash = await sha256Hex(text)
  const alreadyEmbedded = product.embed_status === 'ready' && !!product.embedding
  if (alreadyEmbedded && product.embedding_input_hash === inputHash) {
    return { skipped: true as const }
  }

  const { apiKey, baseUrl } = await ensureProvider()
  await supabase.from('products').update({ embed_status: 'processing', embed_error: null }).eq('id', product.id)
  const vec = await embedText(text, apiKey, baseUrl)
  const { error } = await supabase.from('products').update({
    embedding: vec as any,
    embedding_input_hash: inputHash,
    embed_status: 'ready',
    embed_error: null,
    embedded_at: new Date().toISOString(),
  }).eq('id', product.id)
  if (error) throw new Error(`DB update failed: ${error.message}`)
  return { skipped: false as const }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const body = await req.json().catch(() => ({}))

    let products: any[] = []
    if (body.product_id) {
      const { data, error } = await supabase.from('products').select('*').eq('id', body.product_id).single()
      if (error) throw new Error(`Product not found: ${error.message}`)
      products = [data]
    } else if (body.all_pending) {
      const limit = Math.min(Math.max(body.limit ?? 50, 1), 200)
      const { data, error } = await supabase.from('products').select('*').eq('embed_status', 'pending').limit(limit)
      if (error) throw new Error(error.message)
      products = data || []
    } else {
      return new Response(JSON.stringify({ error: 'Provide product_id or all_pending:true' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (products.length === 0) {
      return new Response(JSON.stringify({ ok: true, embedded: 0, skipped: 0, total: 0, errors: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let providerPromise: Promise<{ apiKey: string; baseUrl: string }> | null = null
    const ensureProvider = () => {
      if (!providerPromise) providerPromise = getProviderConfig(supabase)
      return providerPromise
    }

    const errors: { id: string; error: string }[] = []
    let embedded = 0
    let skipped = 0
    for (const p of products) {
      try {
        const result = await embedOneProduct(supabase, p, ensureProvider)
        if (result.skipped) skipped++
        else embedded++
      } catch (e: any) {
        errors.push({ id: p.id, error: e.message })
        await supabase.from('products').update({
          embed_status: 'error', embed_error: e.message, embedded_at: new Date().toISOString(),
        }).eq('id', p.id)
      }
    }

    return new Response(JSON.stringify({ ok: true, embedded, skipped, total: products.length, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('embed-product error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
