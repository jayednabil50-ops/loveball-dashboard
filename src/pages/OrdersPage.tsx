import { useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShoppingBag, DollarSign, Clock, Truck, Search, RefreshCw, Download, FileText, X } from 'lucide-react';
import { useOrders, useUpdateOrderStatus } from '@/hooks/use-supabase-data';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { Order } from '@/types';

type ManagedOrderStatus = 'Pending' | 'Complete' | 'Delivery' | 'Handover';

const MANAGED_STATUS_OPTIONS: Array<{ value: ManagedOrderStatus; label: string }> = [
  { value: 'Pending', label: 'Pending' },
  { value: 'Complete', label: 'Complete' },
  { value: 'Delivery', label: 'Delivery' },
  { value: 'Handover', label: 'Handover' },
];

function normalizeManagedStatus(status: Order['status']): ManagedOrderStatus {
  if (status === 'Complete' || status === 'Completed') return 'Complete';
  if (status === 'Delivery' || status === 'Delivered') return 'Delivery';
  if (status === 'Handover' || status === 'HandedToDeliveryMan') return 'Handover';
  return 'Pending';
}

const statusColors: Record<ManagedOrderStatus, string> = {
  Pending: 'bg-status-pending/10 text-status-pending border-status-pending/30',
  Complete: 'bg-status-delivered/10 text-status-delivered border-status-delivered/30',
  Delivery: 'bg-status-confirmed/10 text-status-confirmed border-status-confirmed/30',
  Handover: 'bg-kpi-purple-bg text-kpi-purple border-kpi-purple/40',
};

const OrdersPage = () => {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<'all' | ManagedOrderStatus>('all');
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const { data: orders = [], isLoading, isError, error } = useOrders();
  const updateOrderStatus = useUpdateOrderStatus();
  const queryClient = useQueryClient();
  const selectedManagedStatus = selectedOrder ? normalizeManagedStatus(selectedOrder.status) : 'Pending';

  const normalizedOrders = useMemo(
    () =>
      orders.map(order => ({
        ...order,
        status: normalizeManagedStatus(order.status),
      })),
    [orders],
  );

  const filtered = normalizedOrders.filter(order => {
    if (statusFilter !== 'all' && order.status !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      order.customerName.toLowerCase().includes(s) ||
      order.customerPhone.toLowerCase().includes(s) ||
      order.id.toLowerCase().includes(s) ||
      (order.address || '').toLowerCase().includes(s) ||
      (order.items[0]?.name || '').toLowerCase().includes(s)
    );
  });

  const totalRevenue = normalizedOrders.reduce((sum, order) => sum + order.amount, 0);
  const pending = normalizedOrders.filter(order => order.status === 'Pending').length;
  const delivery = normalizedOrders.filter(order => order.status === 'Delivery').length;
  const handover = normalizedOrders.filter(order => order.status === 'Handover').length;

  const colorMap: Record<string, { bg: string; text: string }> = {
    'kpi-blue': { bg: 'bg-kpi-blue-bg', text: 'text-kpi-blue' },
    'kpi-emerald': { bg: 'bg-kpi-emerald-bg', text: 'text-kpi-emerald' },
    'kpi-rose': { bg: 'bg-kpi-rose-bg', text: 'text-kpi-rose' },
    'kpi-purple': { bg: 'bg-kpi-purple-bg', text: 'text-kpi-purple' },
  };

  const kpis = [
    { label: t('orders.totalOrders'), value: normalizedOrders.length, icon: ShoppingBag, color: 'kpi-blue' },
    { label: t('orders.totalRevenue'), value: `BDT ${totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'kpi-emerald' },
    { label: 'Pending', value: pending, icon: Clock, color: 'kpi-rose' },
    { label: 'Delivery', value: delivery + handover, icon: Truck, color: 'kpi-purple' },
  ];

  const printInvoice = (order: Order & { status: ManagedOrderStatus }) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Invoice ${order.id}</title><style>body{font-family:Inter,sans-serif;padding:40px;color:#1a1a2e}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}.total{font-size:1.2em;font-weight:bold}</style></head><body>
      <h1>Invoice</h1><p>Order: ${order.id}</p><p>Date: ${order.date}</p><p>Customer: ${order.customerName}</p><p>Phone: ${order.customerPhone}</p>
      <table><tr><th>Item</th><th>Amount</th></tr>${order.items.map(i => `<tr><td>${i.name}</td><td>BDT ${i.unitPrice || '-'}</td></tr>`).join('')}
      ${order.deliveryFee ? `<tr><td>Delivery Fee</td><td>BDT ${order.deliveryFee}</td></tr>` : ''}
      <tr><td class="total">Total</td><td class="total">BDT ${order.amount.toLocaleString()}</td></tr></table>
      <p>Status: ${order.status}</p></body></html>`);
    w.document.close();
    w.print();
  };

  const onStatusChange = (orderId: string, status: ManagedOrderStatus) => {
    updateOrderStatus.mutate({ orderId, status });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">{t('orders.title')}</h1>
          <Badge variant="secondary">{normalizedOrders.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['orders'] })}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!filtered.length) return;
              const headers = [
                'Order ID',
                'Date',
                'Castomer Name',
                'Casstomer Number',
                'Casstomer Address',
                'Product Name',
                'SKU',
                'Size',
                'Amount',
                'Status',
              ];
              const csvRows = [
                headers.join(','),
                ...filtered.map(o =>
                  [
                    o.id,
                    o.date,
                    o.customerName,
                    o.customerPhone,
                    `"${o.address || ''}"`,
                    `"${o.items[0]?.name || ''}"`,
                    o.sku || '',
                    o.productSize || '',
                    o.amount,
                    o.status,
                  ].join(','),
                ),
              ];
              const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `orders-${new Date().toISOString().split('T')[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="h-4 w-4 mr-1" /> {t('orders.export')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map(kpi => {
          const colors = colorMap[kpi.color];
          return (
            <Card key={kpi.label} className="border-0">
              <CardContent className="p-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors.bg}`}>
                  <kpi.icon className={`h-5 w-5 ${colors.text}`} />
                </div>
                <p className="mt-3 text-2xl font-bold text-foreground">
                  {isLoading ? <Skeleton className="h-8 w-16" /> : kpi.value}
                </p>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={statusFilter} onValueChange={(v: 'all' | ManagedOrderStatus) => setStatusFilter(v)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('orders.allOrders')}</SelectItem>
            {MANAGED_STATUS_OPTIONS.map(status => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer name, number, product or order ID..."
            className="pl-9"
          />
        </div>
        {(statusFilter !== 'all' || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('all'); setSearch(''); }}>
            <X className="h-4 w-4 mr-1" /> Clear
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('orders.orderId')}</TableHead>
              <TableHead>{t('orders.date')}</TableHead>
              <TableHead>Castomer Name</TableHead>
              <TableHead>Casstomer Number</TableHead>
              <TableHead>Casstomer Address</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>{t('orders.amount')}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Invoice</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-destructive">
                  Failed to load order data: {(error as Error)?.message || 'Unknown error'}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  No order found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(order => (
                <TableRow key={order.id} className="cursor-pointer" onClick={() => setSelectedOrder(order)}>
                  <TableCell className="font-mono text-xs">{order.id}</TableCell>
                  <TableCell className="text-sm">{order.date}</TableCell>
                  <TableCell className="text-sm font-medium text-foreground">{order.customerName}</TableCell>
                  <TableCell className="text-sm">{order.customerPhone || '-'}</TableCell>
                  <TableCell className="text-xs max-w-[220px] truncate">{order.address || '-'}</TableCell>
                  <TableCell className="text-sm">{order.items[0]?.name || 'Unknown Product'}</TableCell>
                  <TableCell className="text-xs font-mono">{order.sku || '-'}</TableCell>
                  <TableCell className="text-xs">{order.productSize || '-'}</TableCell>
                  <TableCell className="font-medium">BDT {order.amount.toLocaleString()}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Select
                      value={order.status}
                      onValueChange={(value: ManagedOrderStatus) => onStatusChange(order.id, value)}
                    >
                      <SelectTrigger className={cn('h-8 min-w-[165px] border text-xs', statusColors[order.status])}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MANAGED_STATUS_OPTIONS.map(status => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); printInvoice(order); }}>
                      <FileText className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('orders.invoice')}</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">{t('orders.orderId')}</span>
                <span className="text-sm font-mono">{selectedOrder.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">{t('orders.date')}</span>
                <span className="text-sm">{selectedOrder.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Castomer Name</span>
                <span className="text-sm">{selectedOrder.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Casstomer Number</span>
                <span className="text-sm">{selectedOrder.customerPhone || '-'}</span>
              </div>
              {selectedOrder.address && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Casstomer Address</span>
                  <span className="text-sm text-right max-w-[220px]">{selectedOrder.address}</span>
                </div>
              )}
              <hr className="border-border" />
              <div className="flex justify-between text-sm">
                <span>Product Name</span>
                <span>{selectedOrder.items[0]?.name || 'Unknown Product'}</span>
              </div>
              {selectedOrder.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span>{item.quantity || 1} x {item.name}</span>
                  <span>BDT {item.unitPrice || '-'}</span>
                </div>
              ))}
              {selectedOrder.deliveryFee && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Delivery Fee</span>
                  <span>BDT {selectedOrder.deliveryFee}</span>
                </div>
              )}
              <hr className="border-border" />
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>BDT {selectedOrder.amount.toLocaleString()}</span>
              </div>
              <Select
                value={selectedManagedStatus}
                onValueChange={(value: ManagedOrderStatus) => {
                  onStatusChange(selectedOrder.id, value);
                  setSelectedOrder(prev => (prev ? { ...prev, status: value } : prev));
                }}
              >
                <SelectTrigger className={cn('h-9 border text-sm', statusColors[selectedManagedStatus])}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANAGED_STATUS_OPTIONS.map(status => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => printInvoice(selectedOrder)} className="w-full">
                Print Invoice
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrdersPage;
