/**
 * Einfacher Lasttest-Client (kein oha/bombardier installiert). 50 parallele Verbindungen,
 * 30 Sekunden, gegen "/" und "/produkte/<slug>". Misst Dauer je Request für p95.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:8099/';
const concurrency = Number(process.argv[3] ?? 50);
const durationMs = Number(process.argv[4] ?? 30_000);
const host = process.argv[5] ?? 'team1.example.com';

const latencies: number[] = [];
let ok = 0;
let fail = 0;
const start = performance.now();

async function worker() {
	while (performance.now() - start < durationMs) {
		const t0 = performance.now();
		try {
			const res = await fetch(url, { headers: { Host: host } });
			await res.arrayBuffer();
			const t1 = performance.now();
			latencies.push(t1 - t0);
			if (res.ok) ok++;
			else fail++;
		} catch {
			fail++;
		}
	}
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsedS = (performance.now() - start) / 1000;
latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

console.log(
	JSON.stringify(
		{
			url,
			host,
			concurrency,
			durationS: Math.round(elapsedS),
			requests: ok + fail,
			ok,
			fail,
			reqPerSec: Math.round((ok + fail) / elapsedS),
			p50Ms: Math.round(p50),
			p95Ms: Math.round(p95),
			p99Ms: Math.round(p99)
		},
		null,
		2
	)
);
