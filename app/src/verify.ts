// crypto.subtle.verify is constant-time internally — safer than rolling
// timingSafeEqual on hex strings.

const encoder = new TextEncoder();

let cachedKey: { secret: string; key: CryptoKey } | undefined;

async function getKey(secret: string): Promise<CryptoKey> {
	if (cachedKey?.secret === secret) return cachedKey.key;
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	cachedKey = { secret, key };
	return key;
}

export async function verifySignature(
	secret: string,
	rawBody: string,
	signatureHeader: string | null,
): Promise<boolean> {
	// An empty secret (e.g. `wrangler secret put` run without a TTY uploads "")
	// makes importKey throw. Reject with a clear log instead of a bare 500.
	if (!secret) {
		console.error("GITHUB_WEBHOOK_SECRET is empty; rejecting all webhooks");
		return false;
	}
	if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
	const sigHex = signatureHeader.slice("sha256=".length);
	const sigBytes = hexToBytes(sigHex);
	if (!sigBytes) return false;

	const key = await getKey(secret);
	return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(rawBody));
}

function hexToBytes(hex: string): Uint8Array | null {
	if (hex.length === 0 || hex.length % 2 !== 0) return null;
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(byte)) return null;
		out[i] = byte;
	}
	return out;
}
