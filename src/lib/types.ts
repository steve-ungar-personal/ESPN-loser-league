export type Pos = 'QB' | 'RB' | 'WR' | 'TE' | 'K';
export type SlotKey = 'QB' | 'RB' | 'TEWR' | 'K';

export interface Player {
  id: number;
  name: string;
  pos: Pos;
  proTeam: string;
  bye: number | null;
  espnRank: number | null;
  adp: number | null;
  auctionValue: number | null;
  proj2026: number | null;
  actual2025: number | null;
  injuryStatus: string | null;
  percentOwned: number | null;
}

export interface Drafter {
  id: string;
  name: string;
  slot: number;
  token: string;
  joinedAt: number;
}

export interface Pick {
  overall: number;
  round: number;
  slot: number;
  drafterId: string;
  playerId: number;
  auto: boolean;
  at: number;
}

export type RoomStatus = 'lobby' | 'active' | 'complete';

export interface Room {
  status: RoomStatus;
  pickSeconds: number;
  deadline: number | null;
  commissionerId: string | null;
  drafters: Drafter[];
  picks: Pick[];
  createdAt: number;
  startedAt: number | null;
}

export function emptyRoom(): Room {
  return {
    status: 'lobby',
    pickSeconds: 90,
    deadline: null,
    commissionerId: null,
    drafters: [],
    picks: [],
    createdAt: Date.now(),
    startedAt: null,
  };
}

/** Drafter with the private token stripped — safe to send to any browser. */
export type PublicDrafter = Omit<Drafter, 'token'>;

export interface PublicRoom extends Omit<Room, 'drafters'> {
  drafters: PublicDrafter[];
  onClockSlot: number | null;
  onClockDrafterId: string | null;
  currentRound: number;
  currentPickInRound: number;
  totalPicks: number;
  serverNow: number;
}
