import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  IntegrationErrorResponse,
  IntegrationStatusResponse,
  ListCalendarsResponse,
} from '@tutor-app/shared';
import { ApiError, api } from './api';

export function useIntegrationStatus(): UseQueryResult<IntegrationStatusResponse, ApiError> {
  return useQuery<IntegrationStatusResponse, ApiError>({
    queryKey: ['integration', 'status'],
    queryFn: () => api.integrationStatus(),
    staleTime: 5_000,
  });
}

export type CalendarsQueryResult = ListCalendarsResponse | IntegrationErrorResponse;

export function useGoogleCalendars(
  enabled: boolean,
): UseQueryResult<CalendarsQueryResult, ApiError> {
  return useQuery<CalendarsQueryResult, ApiError>({
    queryKey: ['integration', 'calendars'],
    queryFn: () => api.integrationListCalendars(),
    enabled,
    staleTime: 10_000,
  });
}
