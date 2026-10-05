export interface Team {
  id: number;
  name: string;
  contact?: string;
  phone?: string;
}

export interface Box {
  id: number;
  code: string;
  location?: string;
  capacityKw: number;
  occupied: boolean;
  status: string;
  currentApplication?: {
    id: number;
    teamName: string;
    status: string;
    purpose: string;
  } | null;
}

export interface Meter {
  id: number;
  code: string;
  initialReading: number;
  finalReading?: number | null;
  status: string;
  installedAt: string;
  removedAt?: string | null;
}

export interface Reading {
  id: number;
  meterId: number;
  value: number;
  kind: string;
  status: string;
  recordedBy: string;
  recordedAt: string;
  reviewNote?: string | null;
  reviewedBy?: string | null;
}

export interface Bill {
  id: number;
  applicationId: number;
  totalUsage: number;
  unitPrice: number;
  totalAmount: number;
  createdAt: string;
  detail?: BillDetail;
}

export interface BillDetail {
  segments: {
    meterId: number;
    meterCode: string;
    start: number;
    end: number;
    usage: number;
    installedAt: string;
    removedAt: string | null;
  }[];
  monthly: { month: string; usage: number }[];
  readings: {
    id: number;
    meterCode: string;
    value: number;
    kind: string;
    recordedBy: string;
    recordedAt: string;
  }[];
}

export interface Application {
  id: number;
  teamId: number;
  boxId: number;
  purpose: string;
  plannedStart: string;
  plannedEnd: string;
  status: string;
  team: Team;
  box: { id: number; code: string; location?: string };
  meters: Meter[];
  readings: Reading[];
  bill?: Bill | null;
  createdAt: string;
}

export interface PendingReview {
  id: number;
  value: number;
  kind: string;
  recordedBy: string;
  recordedAt: string;
  reviewNote?: string;
  meter: Meter;
  application: Application;
}

export const STATUS_TEXT: Record<string, string> = {
  PENDING: '待验收',
  ACTIVE: '供电中',
  STOPPING: '停用待核表',
  AWAIT_DISCONNECT: '待拆线',
  COMPLETED: '已完结',
  REJECTED: '已驳回',
  CANCELLED: '已取消',
  IDLE: '空闲',
};

export const KIND_TEXT: Record<string, string> = {
  INITIAL: '起始读数',
  ROUTINE: '日常抄表',
  FINAL: '结算末次',
  SWAP_OLD_FINAL: '换表·旧表末值',
  SWAP_NEW_INITIAL: '换表·新表初值',
};

export const READING_STATUS_TEXT: Record<string, string> = {
  CONFIRMED: '有效',
  PENDING_REVIEW: '待复核',
  REJECTED: '已驳回',
};
