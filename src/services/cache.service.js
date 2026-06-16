const cache = new Map();
const inFlight = new Map(); // Tracks in-progress fetches to avoid thundering herd

/**
 * Simple in-memory cache with TTL and in-flight deduplication.
 * If multiple callers request the same key simultaneously on a cache miss,
 * only ONE fetch is executed and all callers await the same Promise.
 * @param {string} key - Cache key
 * @param {Function} fetcher - Async function to fetch data if cache miss
 * @param {number} ttl - Time to live in seconds (default 60)
 */
const getOrSet = async (key, fetcher, ttl = 60) => {
    const now = Date.now();
    const cached = cache.get(key);

    if (cached && cached.expiry > now) {
        return cached.data;
    }

    // If a fetch is already in progress for this key, await it instead of firing another
    if (inFlight.has(key)) {
        return inFlight.get(key);
    }

    // Start the fetch and register the promise
    const fetchPromise = fetcher().then((data) => {
        cache.set(key, { data, expiry: Date.now() + (ttl * 1000) });
        inFlight.delete(key);
        return data;
    }).catch((err) => {
        inFlight.delete(key); // Always clean up on error
        throw err;
    });

    inFlight.set(key, fetchPromise);
    return fetchPromise;
};

const invalidate = (key) => {
    cache.delete(key);
    inFlight.delete(key);
};

const invalidateAll = () => {
    cache.clear();
    inFlight.clear();
};

module.exports = {
    getOrSet,
    invalidate,
    invalidateAll
};
