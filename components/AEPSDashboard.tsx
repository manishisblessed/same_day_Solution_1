'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, IndianRupee, FileText, TrendingUp, TrendingDown,
  RefreshCw, Settings, AlertCircle, CheckCircle, Clock,
  Fingerprint, Building2, Activity, Smartphone, Shield, X,
  ChevronRight, Plus, History
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetchJson } from '@/lib/api-client';
import ComprehensiveAEPSFlow from './ComprehensiveAEPSFlow';

export default function AEPSDashboard() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);

  // Wait for auth to be ready
  useEffect(() => {
    if (user) {
      setIsLoading(false);
    }
  }, [user]);

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-primary-600 animate-spin" />
        <span className="ml-3 text-gray-600">Loading AEPS services...</span>
      </div>
    );
  }

  return <ComprehensiveAEPSFlow />;
}
