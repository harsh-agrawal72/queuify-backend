const cache = new Map();

/**
 * Simple in-memory cache with TTL
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

    // Cache miss or expired
    const data = await fetcher();
    cache.set(key, {
        data,
        expiry: now + (ttl * 1000)
    });

    return data;
};

const invalidate = (key) => {
    cache.delete(key);
};

const invalidateAll = () => {
    cache.clear();
};

module.exports = {
    getOrSet,
    invalidate,
    invalidateAll
};
