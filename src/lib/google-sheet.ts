import type { Order } from '@/types';

const DEFAULT_ORDERS_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1WmLK-CJzWtcry3gd8fLXKOqbnh8M4Vb7uBWRXHLiJhM/edit?usp=sharing';
const SHEET_ID_REGEX = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

type ParsedCsvRow = Record<string, string> & { __cells?: string[] };

function extractSheetId(input?: string): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  const match = value.match(SHEET_ID_REGEX);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  return null;
}

function extractGid(input?: string): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  const match = value.match(/[?&]gid=(\d+)/);
  return match?.[1] || null;
}

function getOrdersSheetId(): string {
  const fromId = extractSheetId(import.meta.env.VITE_GOOGLE_ORDERS_SHEET_ID);
  if (fromId) return fromId;
  const fromUrl = extractSheetId(import.meta.env.VITE_GOOGLE_ORDERS_SHEET_URL);
  if (fromUrl) return fromUrl;
  return extractSheetId(DEFAULT_ORDERS_SHEET_URL) as string;
}

function getOrdersSheetGid(): string | null {
  const fromEnvGid = (import.meta.env.VITE_GOOGLE_ORDERS_SHEET_GID || '').toString().trim();
  if (/^\d+$/.test(fromEnvGid)) return fromEnvGid;
  return extractGid(import.meta.env.VITE_GOOGLE_ORDERS_SHEET_URL) || extractGid(DEFAULT_ORDERS_SHEET_URL);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current.trim());
  return result;
}

function parseCSV(text: string): ParsedCsvRow[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, ''));

  return lines.slice(1).map(line => {
    const values = parseCSVLine(line).map(v => (v || '').replace(/^"|"$/g, ''));
    const row: ParsedCsvRow = { __cells: values };
    headers.forEach((h, i) => {
      row[h] = values[i] || '';
    });
    return row;
  });
}

function mapStatus(raw: string): Order['status'] {
  const s = (raw || '').toLowerCase().trim();
  if (!s) return 'Pending';
  if (
    s.includes('handover') ||
    s.includes('hand over') ||
    s.includes('delivery man') ||
    s.includes('deliveryman') ||
    s.includes('courier')
  ) return 'Handover';
  if (s.includes('deliver')) return 'Delivery';
  if (s.includes('complete') || s.includes('completed')) return 'Complete';
  if (s.includes('cancel')) return 'Pending';
  if (s.includes('confirm')) return 'Pending';
  return 'Pending';
}

function normalizeHeader(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function getLookup(row: ParsedCsvRow): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('__')) continue;
    lookup.set(normalizeHeader(k), (v || '').trim());
  }
  return lookup;
}

function pick(lookup: Map<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = lookup.get(normalizeHeader(alias));
    if (value) return value;
  }
  return '';
}

function joinUniqueParts(parts: Array<string | undefined | null>): string {
  const normalized = parts
    .map(part => (part || '').trim())
    .filter(Boolean)
    .filter((part, idx, arr) => arr.findIndex(v => v.toLowerCase() === part.toLowerCase()) === idx);
  return normalized.join(', ');
}

function pickCell(cells: string[], index: number): string {
  return (cells[index] || '').trim();
}

function looksLikeUsefulText(value: string): boolean {
  const s = (value || '').trim();
  if (!s) return false;
  if (s === '-' || s.toLowerCase() === 'x' || s.toLowerCase() === 'na' || s.toLowerCase() === 'n/a') return false;
  if (/^\d+$/.test(s)) return false;
  if (/^[\d\s,._-]+$/.test(s)) return false;
  if (/[\u09F3]|taka|tk/i.test(s)) return false;
  return true;
}

function parseNumber(value: string): number {
  const normalized = (value || '').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slug(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function buildFallbackOrderId(i: number, date: string, phone: string, customerName: string, productName: string): string {
  const parts = [slug(date), slug(phone), slug(customerName), slug(productName)].filter(Boolean);
  if (!parts.length) return `gsheet-${i}`;
  return `gs-${parts.join('-')}`;
}

export async function fetchGoogleSheetOrders(): Promise<Order[]> {
  const sheetId = getOrdersSheetId();
  const gid = getOrdersSheetGid();
  const url = gid
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Sheet fetch failed: ${res.status}`);

  const text = await res.text();
  const rows = parseCSV(text);

  return rows
    .map((r, i) => {
      const lookup = getLookup(r);
      const cells = (r.__cells || []).map(v => (v || '').trim());

      const fallbackName = pickCell(cells, 0);
      const fallbackPhone = pickCell(cells, 1);
      const fallbackAddress = joinUniqueParts([pickCell(cells, 2), pickCell(cells, 4), pickCell(cells, 3)]);
      const fallbackProduct =
        [pickCell(cells, 5), pickCell(cells, 6), pickCell(cells, 4), pickCell(cells, 3)].find(looksLikeUsefulText) || '';

      const orderId = pick(lookup, ['Order ID', 'OrderID', 'ID', 'Order No']);
      const rawCustomerName = pick(lookup, ['Customer Name', 'Castomer Name', 'Casstomer Name', 'Name', 'name']);
      const rawCustomerPhone = pick(lookup, ['Customer Number', 'Castomer Number', 'Casstomer Number', 'Phone', 'Mobile', 'Contact Number']);
      const district = pick(lookup, ['District']);
      const thanaArea = pick(lookup, ['Thana + Area', 'Thana/Area', 'Thana Area']);
      const rawAddress = pick(lookup, ['Customer Address', 'Castomer Address', 'Casstomer Address', 'Address']);
      const address = joinUniqueParts([rawAddress, thanaArea, district, fallbackAddress]);

      const rawProductName = pick(lookup, ['Product Name', 'Products Name', 'Product']);

      if (!(rawCustomerName || fallbackName) && !(rawCustomerPhone || fallbackPhone) && !(rawProductName || fallbackProduct)) {
        return null;
      }

      const customerName = rawCustomerName || fallbackName || 'Unknown';
      const customerPhone = rawCustomerPhone || fallbackPhone;
      const productName = rawProductName || fallbackProduct || 'Unknown Product';
      const quantity = parseNumber(pick(lookup, ['Quantity', 'Qty'])) || 1;
      const unitPrice = parseNumber(pick(lookup, ['Unit Price', 'Price']));
      const deliveryFee = parseNumber(pick(lookup, ['Delivery Fee', 'Delivery']));
      const amountFromSheet = parseNumber(pick(lookup, ['Total Amount', 'Amount', 'Total']));
      const totalAmount = amountFromSheet || unitPrice * quantity + deliveryFee;

      const rawDate = pick(lookup, ['Order DateTime', 'Order Date', 'Timestamp', 'Date']);
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const date =
        parsedDate && !Number.isNaN(parsedDate.getTime())
          ? parsedDate.toLocaleDateString('en-GB')
          : rawDate;

      return {
        id: orderId || buildFallbackOrderId(i, rawDate, customerPhone, customerName, productName),
        date: date || '',
        customerName,
        customerPhone,
        address,
        items: [
          {
            name: productName,
            quantity,
            unitPrice,
          },
        ],
        amount: totalAmount,
        deliveryFee: deliveryFee || undefined,
        status: mapStatus(pick(lookup, ['Order Status', 'Status'])),
        productLink: pick(lookup, ['Product Link', 'Link']) || undefined,
        sku: pick(lookup, ['SKU', 'Product SKU', 'Code']) || '',
        productSize: pick(lookup, ['Product Size', 'Size']) || '',
      } as Order;
    })
    .filter((order): order is Order => order !== null);
}
