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
  ttsStatus: ['tts-status'],
  voices: (language) => ['voices', language],
  adminStats: ['admin', 'stats'],
  adminUsers: (q) => ['admin', 'users', q],
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

export const useContinueReading = () =>
  useQuery({ queryKey: keys.continueReading, queryFn: () => api('/progress').then((r) => r.items) });

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

export const useSection = (id, index) => useQuery({ ...sectionQuery(id, index), enabled: Boolean(id) && index >= 0 });

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
