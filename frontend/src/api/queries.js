import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const keys = {
  books: (params) => ['books', params],
  book: (id) => ['book', id],
  sections: (id) => ['sections', id],
  section: (id, index) => ['section', id, index],
  progress: (id) => ['progress', id],
  continueReading: ['continue-reading'],
  bookmarks: (id) => ['bookmarks', id],
  narration: (id) => ['narration', id],
  tags: ['tags'],
  categories: ['categories'],
  ttsStatus: ['tts-status'],
  voices: (language) => ['voices', language],
  adminStats: ['admin', 'stats'],
  adminUsers: (q) => ['admin', 'users', q],
  myAssignments: ['assignments', 'mine'],
  assignments: ['admin', 'assignments'],
  assignmentReport: (id) => ['admin', 'assignments', id],
  activePromotion: (who) => ['promotion', 'active', who],
  promotions: ['admin', 'promotions'],
  paymentConfig: ['payments', 'config'],
  payment: (id) => ['payments', id],
  adminPayments: (status) => ['admin', 'payments', status],
  adminPremium: ['admin', 'premium'],
  bookPremium: (id) => ['admin', 'premium', id],
  systemConfig: ['system', 'config'],
  systemStatus: ['admin', 'system'],
  adminQuotes: ['admin', 'quotes'],
  categoryStarters: ['admin', 'category-starters'],
};

function toQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false && value !== null) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function useBooks(params) {
  return useInfiniteQuery({
    queryKey: keys.books(params),
    queryFn: ({ pageParam, signal }) => api(`/books${toQuery({ ...params, page: pageParam })}`, { signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
}

export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: () => api('/books/tags') });

export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => api('/categories').then((r) => r.categories), staleTime: 5 * 60 * 1000 });

export const useContinueReading = (enabled = true) =>
  useQuery({ queryKey: keys.continueReading, queryFn: () => api('/progress').then((r) => r.items), enabled });

export const useBook = (id) =>
  useQuery({ queryKey: keys.book(id), queryFn: () => api(`/books/${id}`).then((r) => r.book), enabled: Boolean(id) });

export const useSections = (id) =>
  useQuery({
    queryKey: keys.sections(id),
    queryFn: () => api(`/books/${id}/sections`).then((r) => r.sections),
    enabled: Boolean(id),
  });

export const sectionQuery = (id, index) => ({
  queryKey: keys.section(id, index),
  queryFn: () => api(`/books/${id}/sections/${index}`).then((r) => r.section),
  staleTime: 5 * 60 * 1000,
});

// Locked premium chapters aren't requested (the server would answer 402).
export const useSection = (id, index, { locked = false } = {}) =>
  useQuery({ ...sectionQuery(id, index), enabled: Boolean(id) && index >= 0 && !locked });

export const useProgress = (id) =>
  useQuery({
    queryKey: keys.progress(id),
    queryFn: () => api(`/progress/${id}`).then((r) => r.progress),
    staleTime: Infinity,
  });

export const useBookmarks = (id) =>
  useQuery({ queryKey: keys.bookmarks(id), queryFn: () => api(`/books/${id}/bookmarks`).then((r) => r.bookmarks) });

export const useTtsStatus = () =>
  useQuery({ queryKey: keys.ttsStatus, queryFn: () => api('/tts/status'), staleTime: Infinity });

export const useVoices = (language, enabled) =>
  useQuery({
    queryKey: keys.voices(language),
    queryFn: () => api(`/tts/voices${toQuery({ language })}`).then((r) => r.voices),
    enabled,
    staleTime: 60 * 60 * 1000,
  });

// Polls every 3 s while a narration job is running.
export const useNarrationStatus = (id, { initiallyRunning }) =>
  useQuery({
    queryKey: keys.narration(id),
    queryFn: () => api(`/books/${id}/narration`),
    refetchInterval: (query) => ((query.state.data ? query.state.data.running : initiallyRunning) ? 3000 : false),
  });

// Shared helper: run a mutation, then refresh the book and the library.
export function useBookMutation(id, mutationFn, options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    ...options,
    onSuccess: (data, ...rest) => {
      if (data?.book) queryClient.setQueryData(keys.book(id), data.book);
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: keys.continueReading });
      options.onSuccess?.(data, ...rest);
    },
  });
}

export const useAdminStats = () => useQuery({ queryKey: keys.adminStats, queryFn: () => api('/admin/stats') });

export const useAdminUsers = (q) =>
  useQuery({
    queryKey: keys.adminUsers(q),
    queryFn: () => api(`/admin/users${toQuery({ q })}`).then((r) => r.users),
    placeholderData: (previous) => previous,
  });

export const useMyAssignments = (enabled = true) =>
  useQuery({ queryKey: keys.myAssignments, queryFn: () => api('/assignments/mine').then((r) => r.assignments), enabled });

export const useAssignments = () =>
  useQuery({ queryKey: keys.assignments, queryFn: () => api('/assignments').then((r) => r.assignments) });

export const useAssignmentReport = (id) =>
  useQuery({ queryKey: keys.assignmentReport(id), queryFn: () => api(`/assignments/${id}/report`), enabled: Boolean(id) });

// The "support us" popup to show right now, if any (guests and readers can get different ones).
export const useActivePromotion = (who) =>
  useQuery({
    queryKey: keys.activePromotion(who),
    queryFn: () => api('/promotions/active').then((r) => r.promotion),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });

export const usePromotions = () => useQuery({ queryKey: keys.promotions, queryFn: () => api('/promotions') });

export const usePaymentConfig = () =>
  useQuery({ queryKey: keys.paymentConfig, queryFn: () => api('/payments/config'), staleTime: 10 * 60 * 1000 });

// Polls every 3 s while the payer answers the prompt on their phone.
export const usePayment = (id) =>
  useQuery({
    queryKey: keys.payment(id),
    queryFn: () => api(`/payments/${id}`).then((r) => r.payment),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'pending' || !query.state.data ? 3000 : false),
  });

export const usePaymentSetup = () =>
  useQuery({ queryKey: ['admin', 'payments', 'setup'], queryFn: () => api('/payments/setup'), staleTime: 0, retry: false });

export const useAdminPayments = (status) =>
  useQuery({
    queryKey: keys.adminPayments(status),
    queryFn: () => api(`/payments${toQuery({ status })}`),
    placeholderData: (previous) => previous,
  });

// Admin: every premium book with its sales, and one book's premium settings.
export const useAdminPremium = () => useQuery({ queryKey: keys.adminPremium, queryFn: () => api('/admin/premium').then((r) => r.books) });

export const useBookPremium = (id) =>
  useQuery({ queryKey: keys.bookPremium(id), queryFn: () => api(`/admin/books/${id}/premium`).then((r) => r.premium), enabled: Boolean(id) });

// Site settings a super admin controls (sign-ups, uploads, quote popup, announcement).
export const useSystemConfig = () =>
  useQuery({ queryKey: keys.systemConfig, queryFn: () => api('/system/config'), staleTime: 5 * 60 * 1000, retry: false });

export const useSystemStatus = () => useQuery({ queryKey: keys.systemStatus, queryFn: () => api('/system/status') });

export const useAdminQuotes = () => useQuery({ queryKey: keys.adminQuotes, queryFn: () => api('/quotes').then((r) => r.quotes) });

// Common categories the library doesn't have yet (admins can add them in one click).
export const useCategoryStarters = () =>
  useQuery({ queryKey: keys.categoryStarters, queryFn: () => api('/categories/starters').then((r) => r.starters) });
