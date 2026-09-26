import Redis from 'ioredis';
import { REDIS_URL } from '../config';

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

export default redis;
