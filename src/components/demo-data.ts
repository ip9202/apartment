// Demo data for Claude Design App
// Shared across Mobile, Tablet, and Desktop components

export const NOTICES = [
  {
    id: 1,
    title: '[긴급] 태풍 대비 안전 점검 안내',
    category: '일반공지',
    date: '2026.06.20',
    pinned: true,
    content: '태풍 "케이라" 북상으로 인해 단지 내 안전 점검을 실시합니다.\n\n• 외부 시설물 고정 및 점검: 6월 21일 오전 9시\n• 지하주차장 침수 방지 모래주머니 설치: 6월 21일 오전 10시\n• 태풍 통과 예상: 6월 22일 오전 2시 ~ 8시\n\n입주민 여러분께서는 외출을 자제하시고 창문과 베란다 화분 등을 안전하게 정리해 주시기 바랍니다.\n\n문의: 관리사무소 064-762-XXXX'
  },
  {
    id: 2,
    title: '2026년 7월 주차 추첨 공고',
    category: '공지',
    date: '2026.06.19',
    pinned: true,
    content: '2026년 7월 지정 주차 구역 추첨을 아래와 같이 실시합니다.\n\n■ 신청 기간: 2026.06.21(토) ~ 2026.06.25(수)\n■ 대상 구역: A구역(A-01~A-20), B구역(B-01~B-10)\n■ 추첨 방식: 서버 자동 추첨 (결과 즉시 공개)\n■ 신청 방법: 서비스 앱 내 주차 추첨 메뉴\n\n※ 중복 신청 불가, 당첨 구역은 7월 한 달간 유효합니다.'
  },
  {
    id: 3,
    title: 'B동 엘리베이터 정기 점검 안내',
    category: '시설관리',
    date: '2026.06.17',
    pinned: false,
    content: 'B동 엘리베이터 정기 안전 점검이 아래와 같이 진행됩니다.\n\n■ 일시: 2026.06.19(금) 오전 10시 ~ 오후 1시\n■ 해당 엘리베이터: B동 1호기\n■ 점검 업체: (주)오티스엘리베이터코리아\n\n점검 중 일시 이용 중단됩니다. 불편을 드려 죄송합니다.'
  },
  {
    id: 4,
    title: '단지 내 반려동물 에티켓 안내',
    category: '생활안내',
    date: '2026.06.15',
    pinned: false,
    content: '단지 내 반려동물 관련 민원이 증가하고 있어 안내드립니다.\n\n① 반드시 목줄 착용\n② 반려동물 배변 즉시 처리\n③ 엘리베이터 탑승 시 안고 탑승\n④ 야간 짖음 자제\n\n위반 시 입주민 대표회의 규정에 따라 관리될 수 있습니다.'
  },
  {
    id: 5,
    title: '여름철 분리수거 강화 안내',
    category: '생활안내',
    date: '2026.06.10',
    pinned: false,
    content: '여름철 기온 상승으로 분리수거장 악취 및 해충 방지를 위해 분리수거를 강화합니다.\n\n• 음식물 쓰레기: 매일 오전 7시 ~ 오후 8시\n• 재활용 수거: 월·수·금 오전 9시\n• 일반 쓰레기: 전용 봉투 필수\n\n협조해 주셔서 감사합니다.'
  },
];

export const SUGGESTIONS = [
  {
    id: 1,
    title: '엘리베이터 버튼 파손 수리 요청',
    category: '시설',
    status: '완료',
    statusColor: '#16A34A',
    statusBg: '#DCFCE7',
    unit: 'B동 102호',
    date: '2026.06.10',
    isPublic: true,
    content: 'B동 1호기 엘리베이터 2층 버튼이 파손되어 작동이 안 됩니다. 빠른 수리 부탁드립니다.',
    reply: '접수된 건의사항에 감사드립니다. 6월 12일 오전에 수리 완료하였습니다. 불편을 드려 죄송합니다.',
    hasReply: true,
    replyDate: '2026.06.12',
    step: 2
  },
  {
    id: 2,
    title: '지하주차장 3구역 조명 어두움',
    category: '시설',
    status: '처리중',
    statusColor: '#D97706',
    statusBg: '#FEF3C7',
    unit: 'A동 305호',
    date: '2026.06.15',
    isPublic: false,
    content: '지하주차장 B구역 입구 쪽 조명이 많이 어두워서 야간에 위험합니다. LED 교체 혹은 추가 설치 부탁드립니다.',
    reply: null,
    hasReply: false,
    replyDate: null,
    step: 1
  },
  {
    id: 3,
    title: '분리수거장 악취 개선 요청',
    category: '환경',
    status: '접수',
    statusColor: '#0284C7',
    statusBg: '#E0F2FE',
    unit: 'A동 201호',
    date: '2026.06.18',
    isPublic: true,
    content: '분리수거장 주변에 악취가 심하게 납니다. 탈취제 설치나 정기 청소 주기를 늘려주시면 감사하겠습니다.',
    reply: null,
    hasReply: false,
    replyDate: null,
    step: 0
  },
  {
    id: 4,
    title: '옥상 스프링클러 누수 신고',
    category: '안전',
    status: '처리중',
    statusColor: '#D97706',
    statusBg: '#FEF3C7',
    unit: 'B동 401호',
    date: '2026.06.19',
    isPublic: true,
    content: 'B동 옥상 스프링클러에서 물이 새고 있습니다. 안전 점검이 필요합니다.',
    reply: null,
    hasReply: false,
    replyDate: null,
    step: 1
  },
  {
    id: 5,
    title: '택배 무인보관함 증설 요청',
    category: '편의',
    status: '보류',
    statusColor: '#6B7280',
    statusBg: '#F3F4F6',
    unit: 'A동 103호',
    date: '2026.06.20',
    isPublic: false,
    content: '현재 무인보관함이 부족해서 택배 분실 및 반송이 자주 발생합니다. 추가 설치 검토해 주세요.',
    reply: '예산 검토 중입니다. 다음 입주자 대표회의(7월)에서 논의 예정입니다.',
    hasReply: true,
    replyDate: '2026.06.20',
    step: -1
  },
];

// Helper function for timeline colors
export function getTimelineColors(step: number) {
  const baseColors = {
    step0Bg: '#F3F4F6',
    step0Border: '#E5E7EB',
    step0Color: '#9CA3AF',
    step0LabelColor: '#9CA3AF',
    step1Bg: '#F3F4F6',
    step1Border: '#E5E7EB',
    step1Color: '#9CA3AF',
    step1LabelColor: '#9CA3AF',
    step2Bg: '#F3F4F6',
    step2Border: '#E5E7EB',
    step2Color: '#9CA3AF',
    step2LabelColor: '#9CA3AF',
    line1Bg: '#E5E7EB',
    line2Bg: '#E5E7EB',
  };

  if (step < 0) return baseColors;

  return {
    step0Bg: step >= 0 ? '#2563EB' : '#FFFFFF',
    step0Border: step >= 0 ? '#2563EB' : '#E5E7EB',
    step0Color: step >= 0 ? '#FFFFFF' : '#D1D5DB',
    step0LabelColor: step >= 0 ? '#2563EB' : '#9CA3AF',
    step1Bg: step >= 1 ? '#2563EB' : '#FFFFFF',
    step1Border: step >= 1 ? '#2563EB' : '#E5E7EB',
    step1Color: step >= 1 ? '#FFFFFF' : '#D1D5DB',
    step1LabelColor: step >= 1 ? '#2563EB' : '#9CA3AF',
    step2Bg: step >= 2 ? '#2563EB' : '#FFFFFF',
    step2Border: step >= 2 ? '#2563EB' : '#E5E7EB',
    step2Color: step >= 2 ? '#FFFFFF' : '#D1D5DB',
    step2LabelColor: step >= 2 ? '#2563EB' : '#9CA3AF',
    line1Bg: step >= 1 ? '#2563EB' : '#E5E7EB',
    line2Bg: step >= 2 ? '#2563EB' : '#E5E7EB',
  };
}

// Helper function for tab styles
export function getTabStyles(active: boolean) {
  return {
    bg: active ? '#EFF6FF' : 'transparent',
    color: active ? '#2563EB' : '#6B7280',
    border: active ? '#BFDBFE' : '#E5E7EB',
    weight: active ? 700 : 400,
  };
}

// Helper function for category tab styles
export function getCatTabStyles(active: boolean) {
  return {
    bg: active ? '#EFF6FF' : '#F3F4F6',
    color: active ? '#2563EB' : '#6B7280',
    border: active ? '#BFDBFE' : '#E5E7EB',
    weight: active ? 700 : 400,
  };
}

export type Screen =
  | 'login'
  | 'signup'
  | 'verify'
  | 'home'
  | 'notices'
  | 'noticeDetail'
  | 'suggestions'
  | 'newSuggestion'
  | 'suggestionDetail'
  | 'parking'
  | 'mypage'
  | 'admin';
