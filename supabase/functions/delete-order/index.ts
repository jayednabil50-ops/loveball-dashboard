import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_ORDERS_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1WmLK-CJzWtcry3gd8fLXKOqbnh8M4Vb7uBWRXHLiJhM/edit?usp=sharing'
const SHEET_ID_REGEX = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type AppSettingRow = { key: string; value: unknown }

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extractSheetId(input?: string): string | null {
  if (!input) return null
  const value = input.trim()
  if (!value) return null
  const match = value.match(SHEET_ID_REGEX)
  if (match?.[1]) return match[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value
  return null
}

function extractGid(input?: string): number | null {
  if (!input) return null
  const value = input.trim()
  if (!value) return null
  const match = value.match(/[?&]gid=(\d+)/)
  if (!match?.[1]) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

async function loadSettings(supabase: ReturnType<typeof createClient>, keys: string[]) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key,value')
    .in('key', keys)

  if (error) throw new Error(`Failed to load app_settings: ${error.message}`)

  return Object.fromEntries((data || []).map((row: AppSettingRow) => [row.key, row.value]))
}

async function saveSetting(supabase: ReturnType<typeof createClient>, key: string, value: unknown) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) throw new Error(`Failed to save setting "${key}": ${error.message}`)
}

function base64UrlEncode(input: string | Uint8Array) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function getGoogleAccessToken() {
  const serviceAccountJson = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '').trim()
  let clientEmail = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL') || '').trim()
  let privateKey = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY') || '').trim()

  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson)
    clientEmail = clientEmail || (parsed.client_email || '').trim()
    privateKey = privateKey || (parsed.private_key || '').trim()
  }

  if (!clientEmail || !privateKey) {
    throw new Error('Google Sheets delete is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsignedToken))
  const assertion = `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const tokenData = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error((tokenData as any)?.error_description || (tokenData as any)?.error || `Google token API ${tokenRes.status}`)
  }

  return tokenData.access_token as string
}

async function deleteGoogleSheetRow(sheetId: string, sheetTabId: number, rowNumber: number) {
  if (!Number.isFinite(rowNumber) || rowNumber < 2) {
    throw new Error('Invalid Google Sheet row number')
  }

  const accessToken = await getGoogleAccessToken()
  const startIndex = rowNumber - 1
  const endIndex = rowNumber

  const deleteRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetTabId,
              dimension: 'ROWS',
              startIndex,
              endIndex,
            },
          },
        },
      ],
    }),
  })

  const deleteData = await deleteRes.json().catch(() => ({}))
  if (!deleteRes.ok) {
    throw new Error((deleteData as any)?.error?.message || `Google Sheets API ${deleteRes.status}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    const body = await req.json().catch(() => ({}))
    const orderId = (body.orderId || '').toString().trim()
    const dataSource = (body.dataSource || 'google_sheet').toString().trim()
    const sourceRowId = (body.sourceRowId || '').toString().trim()
    const sheetRowNumber = Number(body.sheetRowNumber || 0)
    const explicitSheetTabId = body.sheetTabId == null ? null : Number(body.sheetTabId)

    if (!orderId) {
      return jsonResponse(400, { error: 'orderId is required' })
    }

    const settings = await loadSettings(supabase, [
      'deleted_order_ids',
      'order_status_overrides',
      'google_orders_sheet_url',
      'google_orders_sheet_id',
      'google_orders_sheet_gid',
    ])

    const deletedIds = Array.isArray(settings.deleted_order_ids)
      ? settings.deleted_order_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : []
    if (!deletedIds.includes(orderId)) deletedIds.push(orderId)
    await saveSetting(supabase, 'deleted_order_ids', deletedIds)

    const overrides = settings.order_status_overrides && typeof settings.order_status_overrides === 'object'
      ? { ...(settings.order_status_overrides as Record<string, string>) }
      : {}
    if (orderId in overrides) {
      delete overrides[orderId]
      await saveSetting(supabase, 'order_status_overrides', overrides)
    }

    let sheetDeleted = false
    let warning = ''

    if (dataSource === 'supabase') {
      let deleteError = null

      if (sourceRowId) {
        const { error } = await supabase.from('orders').delete().eq('id', sourceRowId)
        deleteError = error
      }

      if (deleteError || !sourceRowId) {
        const { error } = await supabase.from('orders').delete().eq('order_id', orderId)
        if (error) throw error
      }
    } else {
      const sheetUrl = (settings.google_orders_sheet_url || '').toString().trim() || DEFAULT_ORDERS_SHEET_URL
      const sheetId = extractSheetId((settings.google_orders_sheet_id || '').toString().trim())
        || extractSheetId(sheetUrl)
        || extractSheetId(DEFAULT_ORDERS_SHEET_URL)
      const sheetTabId = Number.isFinite(explicitSheetTabId as number)
        ? Number(explicitSheetTabId)
        : extractGid((settings.google_orders_sheet_gid || '').toString().trim())
          ?? extractGid(sheetUrl)
          ?? extractGid(DEFAULT_ORDERS_SHEET_URL)
          ?? 0

      if (!sheetId) {
        warning = 'Order hidden from dashboard, but Google Sheet ID is not configured for remote deletion.'
      } else if (!Number.isFinite(sheetRowNumber) || sheetRowNumber < 2) {
        warning = 'Order hidden from dashboard, but Google Sheet row number was missing so the source row could not be removed.'
      } else {
        try {
          await deleteGoogleSheetRow(sheetId, Number(sheetTabId), sheetRowNumber)
          sheetDeleted = true
        } catch (error: any) {
          warning = error?.message || 'Google Sheet delete failed'
        }
      }
    }

    return jsonResponse(200, {
      success: true,
      deletedOrderId: orderId,
      dataSource,
      sheetDeleted,
      warning: warning || null,
    })
  } catch (error: any) {
    console.error('delete-order error:', error)
    return jsonResponse(500, { error: error?.message || 'Internal server error' })
  }
})
