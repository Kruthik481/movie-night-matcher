import { createServer } from 'node:http';

const PORT = 4100;
const DECK = [101, 102, 103];

const movie = (id) => ({
  id,
  title: `Test Movie ${id}`,
  release_date: '2024-05-01',
  poster_path: null,
  overview: `Overview for ${id}`,
});

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (pathname === '/health') return send(200, { ok: true });
  if (pathname === '/discover/movie') return send(200, { results: DECK.map((id) => ({ id })) });

  const providers = pathname.match(/^\/movie\/(\d+)\/watch\/providers$/);
  if (providers) {
    return send(200, {
      id: Number(providers[1]),
      results: {
        IN: { link: 'https://www.themoviedb.org', flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: null }] },
      },
    });
  }

  const details = pathname.match(/^\/movie\/(\d+)$/);
  if (details) return send(200, movie(Number(details[1])));

  return send(404, { status_message: 'not found' });
}).listen(PORT, () => console.log(`fake TMDB listening on :${PORT}`));
