const BASE = '/api';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('；') : data?.message ?? res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

export interface Box {
  id: string;
  code: string;
  name: string;
  location?: string;
  status: 'FREE' | 'OCCUPIED';
  currentApplication?: { id: string; code: string; status: string; team: { name: string } } | null;
}

export interface Reading {
  id: string;
  seq: number;
  kind: string;
  value: number;
  meterId: string;
  meter?: { code: string };
  recordedAt: string;
  status: string;
  anomalyReason?: string | null;
  note?: string | null;
  reviewer?: string | null;
}

export interface BillingParsed {
  status: 'FINAL' | 'PENDING_REVIEW';
  totalUsage: number;
  totalAmount: number;
  unitPrice?: number;
  segments: Array<{
    meterCode: string;
    fromReading: string;
    fromValue: number;
    toValue: number;
    fromTime: string;
    toTime: string;
    usage: number;
    billed: boolean;
  }>;
  monthly: Array<{ month: string; usage: number; amount: number; days: number }>;
  chain: Array<{ seq: number; meterCode: string; kind: string; value: number; recordedAt: string; status: string }>;
}

export interface Application {
  id: string;
  code: string;
  status: string;
  purpose: string;
  plannedStart: string;
  plannedEnd?: string | null;
  activatedAt?: string | null;
  stoppedAt?: string | null;
  releasedAt?: string | null;
  rejectReason?: string | null;
  team: { id: string; name: string; contact?: string | null };
  box: Box;
  currentMeter?: { id: string; code: string } | null;
  readings: Reading[];
  meterChanges: Array<{ id: string; changedAt: string }>;
  billing?: {
    id: string;
    status: string;
    totalUsage: number;
    totalAmount: number;
    generatedAt: string;
  } | null;
  billingParsed?: BillingParsed | null;
  preview?: BillingParsed;
}

export const api = {
  listBoxes: () => req<Box[]>('/boxes'),
  listApps: () => req<Application[]>('/applications'),
  getApp: (id: string) => req<Application>(`/applications/${id}`),
  apply: (body: Record<string, unknown>) =>
    req<Application>('/applications', { method: 'POST', body: JSON.stringify(body) }),
  activate: (id: string, body: Record<string, unknown>) =>
    req<Application>(`/applications/${id}/activate`, { method: 'POST', body: JSON.stringify(body) }),
  reject: (id: string, reason: string) =>
    req<Application>(`/applications/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  record: (id: string, body: { value: number; recordedAt?: string; note?: string }) =>
    req<{ reading: Reading; previous: Reading | null; anomaly: string | null }>(
      `/applications/${id}/readings`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  review: (id: string, rid: string, body: Record<string, unknown>) =>
    req<Application>(`/applications/${id}/readings/${rid}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  changeMeter: (id: string, body: Record<string, unknown>) =>
    req<Application>(`/applications/${id}/change-meter`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stop: (id: string, body: { finalValue: number; recordedAt?: string }) =>
    req<Application>(`/applications/${id}/stop`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  release: (id: string, electrician?: string) =>
    req<Application>(`/applications/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ electrician }),
    }),
};
