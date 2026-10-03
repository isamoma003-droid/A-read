import { useEffect } from 'react';

// Page hints for search engines. Google runs the app's JavaScript before indexing, so these are
// read just like tags written into the HTML.

export const siteUrl = (path) => new URL(path, window.location.origin).href;

// <link rel="canonical">: the one address this page should be indexed under.
export function useCanonical(path) {
  useEffect(() => {
    if (!path) return undefined;
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = siteUrl(path);
    document.head.appendChild(link);
    return () => link.remove();
  }, [path]);
}

// Structured data (schema.org JSON-LD) describing the page's book or author, which search engines
// use for richer results (author, cover, rating, price).
export function useJsonLd(data) {
  const json = data ? JSON.stringify({ '@context': 'https://schema.org', ...data }) : '';
  useEffect(() => {
    if (!json) return undefined;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = json;
    document.head.appendChild(script);
    return () => script.remove();
  }, [json]);
}
