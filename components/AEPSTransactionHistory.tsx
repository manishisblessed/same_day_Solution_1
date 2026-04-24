'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Search, Filter, Download, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Clock, AlertCircle, Wallet, CreditCard,
  FileText, IndianRupee, Calendar, Eye
} from 'lucide-react';
import { motion } from 'framer-motion';
import { apiFetchJson } from '@/lib/api-client';
import type { AEPSTransactionType, AEPSStatus } from '@/types/aeps.types';

interface Transaction {
  id: string;
  transaction_type: AEPSTransactionType;
  amount: number | null;
  status: AEPSStatus;
  order_id?: string;
  utr?: string;
  bank_name?: string;
  aadhaar_number_masked?: string;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  balance_after?: number;
}

interface AEPSTransactionHistoryProps {
  limit?: number;
  showFilters?: boolean;
  onViewDetails?: (transaction: Transaction) => void;
}

const statusConfig: Record<AEPSStatus, { icon: React.ElementType; color: string; bg: string }> = {
  pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100' },
  processing: { icon: RefreshCw, color: 'text-blue-600', bg: 'bg-blue-100' },
  success: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100' },
  reversed: { icon: AlertCircle, color: 'text-purple-600', bg: 'bg-purple-100' },
  under_reconciliation: { icon: Clock, color: 'text-gray-600', bg: 'bg-gray-100' },
};

const typeConfig: Record<AEPSTransactionType, { label: string; icon: React.ElementType; color: string }> = {
  balance_inquiry: { label: 'Balance', icon: Wallet, color: 'text-blue-600' },
  cash_withdrawal: { label: 'Withdrawal', icon: IndianRupee, color: 'text-green-600' },
  cash_deposit: { label: 'Deposit', icon: CreditCard, color: 'text-purple-600' },
  mini_statement: { label: 'Statement', icon: FileText, color: 'text-orange-600' },
  aadhaar_to_aadhaar: { label: 'A2A Transfer', icon: CreditCard, color: 'text-indigo-600' },
};

export default function AEPSTransactionHistory({
  limit = 10,
  showFilters = true,
  onViewDetails,
}: AEPSTransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      params.set('service', 'aeps');
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (search) params.set('search', search);

      const response = await apiFetchJson(`/api/reports/transactions?${params.toString()}`);
      
      if (response.transactions) {
        setTransactions(response.transactions);
        setTotal(response.total || response.transactions.length);
        setTotalPages(Math.ceil((response.total || response.transactions.length) / limit));
      } else {
        setTransactions([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, statusFilter, typeFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number | null): string => {
    if (amount === null || amount === undefined) return '-';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      params.set('service', 'aeps');
      params.set('format', 'csv');
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const response = await fetch(`/api/reports/transactions/export?${params.toString()}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aeps-transactions-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">AEPS Transactions</h3>
            <p className="text-sm text-gray-500">{total} total transactions</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadTransactions}
              disabled={isLoading}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="reversed">Reversed</option>
            </select>

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">All Types</option>
              <option value="balance_inquiry">Balance Inquiry</option>
              <option value="cash_withdrawal">Cash Withdrawal</option>
              <option value="cash_deposit">Cash Deposit</option>
              <option value="mini_statement">Mini Statement</option>
            </select>

            {/* Date From */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Date To */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-primary-600 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
            <p className="text-red-600">{error}</p>
            <button
              onClick={loadTransactions}
              className="mt-4 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50 rounded-lg"
            >
              Try Again
            </button>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500">No transactions found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Date/Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Details
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((txn, index) => {
                const status = statusConfig[txn.status] || statusConfig.pending;
                const type = typeConfig[txn.transaction_type] || typeConfig.balance_inquiry;
                const StatusIcon = status.icon;
                const TypeIcon = type.icon;

                return (
                  <motion.tr
                    key={txn.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="hover:bg-gray-50"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{formatDate(txn.created_at)}</div>
                      {txn.order_id && (
                        <div className="text-xs text-gray-500 font-mono">{txn.order_id}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <TypeIcon className={`w-4 h-4 ${type.color}`} />
                        <span className="text-sm font-medium text-gray-900">{type.label}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{txn.bank_name || '-'}</div>
                      {txn.aadhaar_number_masked && (
                        <div className="text-xs text-gray-500">{txn.aadhaar_number_masked}</div>
                      )}
                      {txn.utr && (
                        <div className="text-xs text-gray-400 font-mono">UTR: {txn.utr}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`text-sm font-semibold ${
                        txn.transaction_type === 'cash_withdrawal' ? 'text-red-600' :
                        txn.transaction_type === 'cash_deposit' ? 'text-green-600' :
                        'text-gray-900'
                      }`}>
                        {txn.transaction_type === 'cash_withdrawal' && txn.amount ? '-' : ''}
                        {formatCurrency(txn.amount)}
                      </span>
                      {txn.balance_after !== undefined && txn.balance_after !== null && (
                        <div className="text-xs text-gray-500">
                          Bal: ₹{txn.balance_after.toLocaleString('en-IN')}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {txn.status.charAt(0).toUpperCase() + txn.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => onViewDetails?.(txn)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
