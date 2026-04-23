import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Package, Plus, Pencil, Trash2, RefreshCw, Search, X, Upload, Sparkles, CheckCircle2, AlertCircle, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';

type EmbedStatus = 'pending' | 'processing' | 'ready' | 'error';

interface Product {
  id: string;
  category: string | null;
  name: string;
  sku: string | null;
  price: number | null;
  capacity: string | null;
  burner_size: string | null;
  height: string | null;
  includes: string | null;
  material: string | null;
  fan_type: string | null;
  image_url: string | null;
  video_url: string | null;
  embed_status?: EmbedStatus;
  embed_error?: string | null;
  embedded_at?: string | null;
}

function EmbedBadge({ status, error }: { status?: EmbedStatus; error?: string | null }) {
  if (status === 'ready') {
    return <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"><CheckCircle2 className="h-3 w-3" />Ready</Badge>;
  }
  if (status === 'processing') {
    return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Embedding</Badge>;
  }
  if (status === 'error') {
    return <Badge variant="destructive" className="gap-1" title={error || ''}><AlertCircle className="h-3 w-3" />Error</Badge>;
  }
  return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
}

type ProductForm = Omit<Product, 'id' | 'price'> & { price: string };

const emptyForm: ProductForm = {
  category: '', name: '', sku: '', price: '', capacity: '', burner_size: '',
  height: '', includes: '', material: '', fan_type: '', image_url: '', video_url: '',
};

const fields: { key: keyof ProductForm; label: string; type?: string; full?: boolean }[] = [
  { key: 'name', label: 'Name' },
  { key: 'sku', label: 'SKU / Code' },
  { key: 'category', label: 'Category' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'burner_size', label: 'Burner Size' },
  { key: 'height', label: 'Height' },
  { key: 'material', label: 'Material' },
  { key: 'fan_type', label: 'Fan Type' },
  { key: 'image_url', label: 'Image URL', full: true },
  { key: 'video_url', label: 'Video URL', full: true },
  { key: 'includes', label: 'Includes', full: true },
];

const ProductsPage = () => {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: products = [], isLoading, isError, error } = useQuery({
    queryKey: ['products'],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products' as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Product[];
    },
  });

  const triggerEmbed = async (productId: string) => {
    try {
      await supabase.functions.invoke('embed-product', { body: { product_id: productId } });
    } catch (e) {
      console.warn('embed-product trigger failed:', e);
    }
  };

  const embedAllPending = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('embed-product', {
        body: { all_pending: true, limit: 200 },
      });
      if (error) throw error;
      return data as { embedded: number; total: number; errors: any[] };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      if (res.errors?.length) {
        toast.warning(`Embedded ${res.embedded}/${res.total}. ${res.errors.length} failed.`);
      } else {
        toast.success(`Embedded ${res.embedded} product${res.embedded === 1 ? '' : 's'}`);
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to embed products'),
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: { id?: string; values: Partial<Product> }) => {
      if (payload.id) {
        const { error } = await supabase.from('products' as any).update(payload.values).eq('id', payload.id);
        if (error) throw error;
        return payload.id;
      } else {
        const { data, error } = await supabase.from('products' as any).insert(payload.values).select('id').single();
        if (error) throw error;
        return (data as any).id as string;
      }
    },
    onSuccess: (newId, vars) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(vars.id ? 'Product updated' : 'Product created');
      closeModal();
      if (newId) triggerEmbed(newId);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product deleted');
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete'),
  });

  const importMutation = useMutation({
    mutationFn: async (rows: Partial<Product>[]) => {
      if (rows.length === 0) throw new Error('CSV is empty');
      const { error } = await supabase.from('products' as any).insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(`Imported ${count} product${count === 1 ? '' : 's'}. Embedding in background...`);
      // Trigger embedding for all newly imported (pending) products
      embedAllPending.mutate();
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to import CSV'),
  });

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        const allowed = ['category', 'name', 'price', 'capacity', 'burner_size', 'height', 'includes', 'material', 'fan_type', 'image_url', 'video_url'];
        const rows: Partial<Product>[] = results.data
          .map((r) => {
            const row: any = {};
            const skuValue = r.sku ?? r.code ?? r.product_code ?? r.product_sku ?? r.sq;
            if (skuValue != null && skuValue !== '') {
              row.sku = String(skuValue).trim();
            }
            allowed.forEach((k) => {
              const v = r[k];
              if (v == null || v === '') return;
              row[k] = k === 'price' ? Number(v) : String(v).trim();
            });
            return row;
          })
          .filter((r) => r.name);
        if (rows.length === 0) {
          toast.error('No valid rows found. Make sure CSV has a "name" column.');
        } else {
          importMutation.mutate(rows);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      error: (err) => {
        toast.error(`CSV parse error: ${err.message}`);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      category: p.category ?? '', name: p.name ?? '', sku: p.sku ?? '',
      price: p.price != null ? String(p.price) : '',
      capacity: p.capacity ?? '', burner_size: p.burner_size ?? '',
      height: p.height ?? '', includes: p.includes ?? '',
      material: p.material ?? '', fan_type: p.fan_type ?? '',
      image_url: p.image_url ?? '', video_url: p.video_url ?? '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    const values: Partial<Product> = {
      category: form.category || null,
      name: form.name.trim(),
      sku: form.sku || null,
      price: form.price ? Number(form.price) : null,
      capacity: form.capacity || null,
      burner_size: form.burner_size || null,
      height: form.height || null,
      includes: form.includes || null,
      material: form.material || null,
      fan_type: form.fan_type || null,
      image_url: form.image_url || null,
      video_url: form.video_url || null,
    };
    upsertMutation.mutate({ id: editing?.id, values });
  };

  const filtered = products.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      p.name?.toLowerCase().includes(s) ||
      p.sku?.toLowerCase().includes(s) ||
      p.category?.toLowerCase().includes(s) ||
      p.material?.toLowerCase().includes(s)
    );
  });

  const pendingCount = products.filter(p => p.embed_status === 'pending' || p.embed_status === 'error').length;
  const readyCount = products.filter(p => p.embed_status === 'ready').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">Products</h1>
          <Badge variant="secondary">{products.length}</Badge>
          {readyCount > 0 && (
            <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              <Sparkles className="h-3 w-3" />{readyCount} embedded
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />{pendingCount} pending
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvUpload}
          />
          {pendingCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => embedAllPending.mutate()}
              disabled={embedAllPending.isPending}
            >
              {embedAllPending.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Embedding...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1" />Embed {pendingCount} pending</>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            <Upload className="h-4 w-4 mr-1" />
            {importMutation.isPending ? 'Importing...' : 'Import CSV'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['products'] })}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New Product
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
            <X className="h-4 w-4 mr-1" /> Clear
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Image</TableHead>
              <TableHead>AI</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>SKU / Code</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Burner Size</TableHead>
              <TableHead>Height</TableHead>
              <TableHead>Includes</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Fan Type</TableHead>
              <TableHead>Image URL</TableHead>
              <TableHead>Video URL</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 15 }).map((_, j) => (
                <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
              ))}</TableRow>
            )) : isError ? (
              <TableRow>
                <TableCell colSpan={15} className="text-center py-8 text-destructive">
                  ⚠️ {(error as Error)?.message || 'Failed to load products'}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="text-center py-12 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  {search ? 'No products match your search' : 'No products yet. Click "New Product" to add one.'}
                </TableCell>
              </TableRow>
            ) : filtered.map(p => (
              <TableRow key={p.id}>
                <TableCell>
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="h-10 w-10 rounded object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </TableCell>
                <TableCell><EmbedBadge status={p.embed_status} error={p.embed_error} /></TableCell>
                <TableCell className="text-sm">{p.category || '-'}</TableCell>
                <TableCell className="text-sm font-medium">{p.name}</TableCell>
                <TableCell className="text-sm">{p.sku || '-'}</TableCell>
                <TableCell className="text-sm font-medium">{p.price != null ? `৳${Number(p.price).toLocaleString()}` : '-'}</TableCell>
                <TableCell className="text-sm">{p.capacity || '-'}</TableCell>
                <TableCell className="text-sm">{p.burner_size || '-'}</TableCell>
                <TableCell className="text-sm">{p.height || '-'}</TableCell>
                <TableCell className="text-xs max-w-[160px] truncate" title={p.includes || ''}>{p.includes || '-'}</TableCell>
                <TableCell className="text-sm">{p.material || '-'}</TableCell>
                <TableCell className="text-sm">{p.fan_type || '-'}</TableCell>
                <TableCell className="text-xs max-w-[140px] truncate">
                  {p.image_url ? <a href={p.image_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{p.image_url}</a> : '-'}
                </TableCell>
                <TableCell className="text-xs max-w-[140px] truncate">
                  {p.video_url ? <a href={p.video_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{p.video_url}</a> : '-'}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Re-embed"
                      onClick={() => triggerEmbed(p.id).then(() => qc.invalidateQueries({ queryKey: ['products'] }))}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteId(p.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={modalOpen} onOpenChange={(o) => !o && closeModal()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Product' : 'New Product'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update product details below.' : 'Fill in the product details below.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map(f => (
                <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                  <Label htmlFor={f.key} className="mb-1.5 block">
                    {f.label} {f.key === 'name' && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id={f.key}
                    type={f.type || 'text'}
                    value={form[f.key]}
                    onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    placeholder={f.label}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>Cancel</Button>
              <Button type="submit" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this product?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The product will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProductsPage;
