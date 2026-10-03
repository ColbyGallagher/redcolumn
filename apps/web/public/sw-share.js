// Loaded into the service worker (workbox importScripts; see vite.config.ts). PDFs shared to the
// installed app from other apps arrive as a POST to share-target (the manifest's share_target).
// They are kept in the 'nb-share' cache and the app is opened with ?action=shared, which reads
// them from there (src/offline/launch.ts) and opens them.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.method !== 'POST' || url.pathname !== `${scope.pathname}share-target`) return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll('files').filter((f) => typeof f !== 'string');
        const cache = await caches.open('nb-share');
        // A fresh batch replaces anything left from a share the app never picked up.
        for (const key of await cache.keys()) await cache.delete(key);
        let n = 0;
        for (const file of files) {
          const headers = { 'content-type': file.type || 'application/pdf', 'x-name': encodeURIComponent(file.name || `Shared ${n + 1}.pdf`) };
          await cache.put(`${scope.pathname}share-target/${Date.now()}-${n++}`, new Response(file, { headers }));
        }
        // A link shared on its own (no file) is passed through, in case it points at a PDF.
        const link = form.get('url') || form.get('text');
        const extra = !files.length && typeof link === 'string' && /^https?:\/\//.test(link.trim()) ? `&url=${encodeURIComponent(link.trim())}` : '';
        return Response.redirect(`${scope.pathname}?action=shared${extra}`, 303);
      } catch {
        return Response.redirect(`${scope.pathname}?action=shared&error=1`, 303);
      }
    })(),
  );
});
