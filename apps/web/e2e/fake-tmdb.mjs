import { createServer } from 'node:http';

const PORT = 4100;
// SHOTS=1 serves real titles and TMDB poster paths for visual review; tests use the plain fixtures
const SHOWCASE = {
  101: ['Interstellar', '2014-11-07', '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg'],
  102: ['Inception', '2010-07-16', '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg'],
  103: ['The Dark Knight', '2008-07-18', '/qJ2tW6WMUDux911r6m7haRef0WH.jpg'],
  104: ['Fight Club', '1999-10-15', '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg'],
  105: ['Parasite', '2019-05-30', '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg'],
  106: ['Whiplash', '2014-10-10', '/7fn624j5lj3xTme2SgiLCeuedmO.jpg'],
};
const isShowcase = process.env.SHOTS === '1';
const DECK = isShowcase ? [101, 102, 103, 104, 105, 106] : [101, 102, 103];

const movie = (id) => {
  const showcase = isShowcase ? SHOWCASE[id] : undefined;
  return {
    id,
    title: showcase ? showcase[0] : `Test Movie ${id}`,
    release_date: showcase ? showcase[1] : '2024-05-01',
    poster_path: showcase ? showcase[2] : null,
    overview: showcase
      ? 'A crew sets out on an impossible mission while the clock, and everyone they love, slips away.'
      : `Overview for ${id}`,
  };
};

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
