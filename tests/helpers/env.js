export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export function socketBaseUrl() {
  const u = new URL(BASE_URL);
  return `${u.protocol}//${u.host}`;
}
