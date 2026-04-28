'use client';

import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import AEPSUnifiedFlow from './AEPSUnifiedFlow';

export default function AEPSDashboard() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      setIsLoading(false);
    }
  }, [user]);

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
        <span className="ml-3 text-gray-600">Loading AEPS services...</span>
      </div>
    );
  }

  return (
    <AEPSUnifiedFlow
      user={{
        partner_id: user.partner_id || '',
        email: user.email || '',
        role: user.role || '',
        name: user.name
      }}
    />
  );
}
