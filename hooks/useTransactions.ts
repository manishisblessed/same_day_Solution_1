import { useState, useEffect, useCallback, useRef } from 'react'
import { TransactionFilters, TransactionListResponse, RazorpayTransaction } from '@/types/database.types'

interface UseTransactionsOptions {
  autoPoll?: boolean
  pollInterval?: number // in milliseconds
  initialFilters?: TransactionFilters
}

export function useTransactions(options: UseTransactionsOptions = {}) {
  const {
    autoPoll = true,
    pollInterval = 10000, // 10 seconds default
    initialFilters = {}
  } = options

  const [transactions, setTransactions] = useState<RazorpayTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<TransactionFilters>(initialFilters)
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 0
  })

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastFetchTimeRef = useRef<number>(0)

  const fetchTransactions = useCallback(async (currentFilters: TransactionFilters = filters) => {
    try {
      setLoading(true)
      setError(null)

      // Build query string
      const params = new URLSearchParams()
      if (currentFilters.dateFrom) params.append('dateFrom', currentFilters.dateFrom)
      if (currentFilters.dateTo) params.append('dateTo', currentFilters.dateTo)
      if (currentFilters.tid) params.append('tid', currentFilters.tid)
      if (currentFilters.rrn) params.append('rrn', currentFilters.rrn)
      if (currentFilters.status && currentFilters.status !== 'all') {
        params.append('status', currentFilters.status)
      }
      if (currentFilters.retailer_id) params.append('retailer_id', currentFilters.retailer_id)
      if (currentFilters.distributor_id) params.append('distributor_id', currentFilters.distributor_id)
      if (currentFilters.master_distributor_id) {
        params.append('master_distributor_id', currentFilters.master_distributor_id)
      }
      if (currentFilters.minAmount !== undefined) {
        params.append('minAmount', currentFilters.minAmount.toString())
      }
      if (currentFilters.maxAmount !== undefined) {
        params.append('maxAmount', currentFilters.maxAmount.toString())
      }
      params.append('page', (currentFilters.page || 1).toString())
      params.append('limit', (currentFilters.limit || 50).toString())
      params.append('sortBy', currentFilters.sortBy || 'created_at')
      params.append('sortOrder', currentFilters.sortOrder || 'desc')

      const response = await fetch(`/api/transactions?${params.toString()}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch transactions')
      }

      const data: TransactionListResponse = await response.json()
      
      setTransactions(data.transactions)
      setPagination({
        total: data.total,
        page: data.page,
        limit: data.limit,
        totalPages: data.totalPages
      })

      lastFetchTimeRef.current = Date.now()
    } catch (err: any) {
      console.error('Error fetching transactions:', err)
      setError(err.message || 'Failed to fetch transactions')
    } finally {
      setLoading(false)
    }
  }, [filters])

  // Update filters and refetch
  const updateFilters = useCallback((newFilters: Partial<TransactionFilters>) => {
    const updatedFilters = { ...filters, ...newFilters, page: 1 } // Reset to page 1 on filter change
    setFilters(updatedFilters)
    fetchTransactions(updatedFilters)
  }, [filters, fetchTransactions])

  // Change page
  const changePage = useCallback((page: number) => {
    const updatedFilters = { ...filters, page }
    setFilters(updatedFilters)
    fetchTransactions(updatedFilters)
  }, [filters, fetchTransactions])

  // Refresh transactions
  const refresh = useCallback(() => {
    fetchTransactions(filters)
  }, [fetchTransactions, filters])

  // Set up polling
  useEffect(() => {
    // Initial fetch
    fetchTransactions()

    // Set up polling if enabled
    if (autoPoll) {
      pollIntervalRef.current = setInterval(() => {
        // Only poll if enough time has passed since last fetch
        const timeSinceLastFetch = Date.now() - lastFetchTimeRef.current
        if (timeSinceLastFetch >= pollInterval - 1000) { // Allow 1 second buffer
          fetchTransactions(filters)
        }
      }, pollInterval)
    }

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [autoPoll, pollInterval]) // Only re-run if polling settings change

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  return {
    transactions,
    loading,
    error,
    filters,
    pagination,
    updateFilters,
    changePage,
    refresh,
    refetch: fetchTransactions
  }
}















