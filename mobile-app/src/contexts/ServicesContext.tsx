import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEnabledServices, visibleServices, ServiceDef } from '@/api/services';
import { EnabledServices, ServiceKey } from '@/api/types';
import { useAuth } from './AuthContext';

interface ServicesState {
  services: EnabledServices;
  visible: ServiceDef[];
  hasAnyEnabled: boolean;
  isEnabled: (key: ServiceKey) => boolean;
  loading: boolean;
  refetch: () => void;
}

const ServicesContext = createContext<ServicesState>({} as ServicesState);
export const useServices = () => useContext(ServicesContext);

export const ServicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['enabled-services', user?.id],
    queryFn: fetchEnabledServices,
    enabled: !!user,
    staleTime: 15_000,
    // Poll so admin changes propagate to the app without a restart.
    refetchInterval: 60_000,
  });

  const services = data?.services ?? {};
  const value: ServicesState = {
    services,
    visible: visibleServices(services),
    hasAnyEnabled: data?.hasAnyEnabled ?? false,
    isEnabled: (key) => !!services[key],
    loading: isLoading,
    refetch,
  };

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
};
